"""User support and staff-only trust-and-safety APIs."""
import secrets
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, UploadFile, File
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user import User
from app.models.session import UserSession
from app.models.social import Report
from app.models.staff import (SupportCase, CaseMessage, CaseAttachment, StaffNotification,
    ModeratorAuditLog, StaffInvitation, ModerationAction, Appeal)
from app.security.dependencies import get_current_user, get_staff_user, get_owner_user, get_recent_owner
from app.security.jwt import hash_token
from app.security.jwt import decode_token
from app.schemas.auth import LoginRequest, TwoFactorVerifyRequest
from app.services.auth_service import AuthService
from app.routes.auth import guard_auth
from app.services.rate_limit import throttle


router = APIRouter(tags=["Support and staff"])

CASE_KINDS = {"BUG", "FEEDBACK", "FEATURE", "COMPLAINT", "SUPPORT", "SECURITY"}
CASE_STATUSES = {"NEW", "TRIAGED", "IN_PROGRESS", "WAITING_FOR_USER", "RESOLVED", "CLOSED"}
REPORT_STATUSES = {"NEW", "TRIAGED", "WAITING_FOR_USER", "DISMISSED", "WARNED", "ESCALATED", "RESOLVED"}
PRIORITIES = {"LOW", "NORMAL", "HIGH", "CRITICAL"}
BUG_CATEGORIES = {"Messaging", "Calls", "Stories", "Login", "Media", "UI/UX", "Performance", "Other"}


def iso(value):
    return value.isoformat() if value else None


def case_data(row: SupportCase, staff=False):
    data = {key: getattr(row, key) for key in ("id", "reporter_id", "kind", "category", "title",
        "description", "steps", "expected", "actual", "attachment_url", "rating", "diagnostics",
        "app_version", "status", "priority", "assigned_to_id", "duplicate_of_id")}
    data["created_at"] = iso(row.created_at)
    data["updated_at"] = iso(row.updated_at)
    if not staff:
        data.pop("diagnostics", None)
    return data


def message_data(row: CaseMessage):
    return {"id": row.id, "case_id": row.case_id, "author_id": row.author_id,
            "body": row.body, "created_at": iso(row.created_at)}


def notify_staff(db: Session, event: str, target_type: str, target_id: int, title: str):
    staff = db.query(User.id).filter(User.role.in_(["MODERATOR", "OWNER"]), User.totp_enabled == True).all()
    for (user_id,) in staff:
        db.add(StaffNotification(recipient_id=user_id, event=event, target_type=target_type,
                                 target_id=target_id, title=title[:160]))


def audit(db: Session, actor: User, action: str, target_type: str, target_id: int,
          reason: str = "", result: str = "SUCCESS"):
    db.add(ModeratorAuditLog(actor_id=actor.id, action=action, target_type=target_type,
                             target_id=target_id, reason=reason[:500], result=result))


class CaseCreate(BaseModel):
    kind: Literal["BUG", "FEEDBACK", "FEATURE", "COMPLAINT", "SUPPORT", "SECURITY"]
    category: str = Field(min_length=2, max_length=32)
    title: str = Field(min_length=5, max_length=160)
    description: str = Field(min_length=10, max_length=5000)
    steps: str | None = Field(default=None, max_length=3000)
    expected: str | None = Field(default=None, max_length=3000)
    actual: str | None = Field(default=None, max_length=3000)
    rating: int | None = Field(default=None, ge=1, le=5)
    diagnostics: str | None = Field(default=None, max_length=2000)


class MessageCreate(BaseModel):
    body: str = Field(min_length=2, max_length=4000)
    internal: bool = False


class CaseUpdate(BaseModel):
    status: str | None = None
    priority: str | None = None
    assigned_to_id: int | None = None
    duplicate_of_id: int | None = None
    reason: str = Field(min_length=3, max_length=500)


class ReportUpdate(BaseModel):
    status: str
    priority: str | None = None
    assigned_to_id: int | None = None
    reason: str = Field(min_length=3, max_length=500)


@router.post("/staff/auth/login")
def staff_login(data: LoginRequest, request: Request, db: Session = Depends(get_db)):
    identifier = (data.username_or_email or data.identifier or "").strip().lower()
    guard_auth(db, request, "STAFF_LOGIN", identifier, 8)
    user = db.query(User).filter(or_(User.username == identifier, User.email == identifier,
                                     User.phone_number == identifier)).first()
    if not user or user.role not in {"MODERATOR", "OWNER"} or not user.totp_enabled or not user.is_verified:
        raise HTTPException(401, "Invalid staff credentials")
    result = AuthService.authenticate_user(db, data, request)
    if not result.get("requires_2fa"):
        raise HTTPException(403, "Staff MFA required")
    return result


@router.post("/staff/auth/verify")
def staff_verify(data: TwoFactorVerifyRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    guard_auth(db, request, "STAFF_MFA", hash_token(data.ticket), 8)
    payload = decode_token(data.ticket)
    if not payload or payload.get("type") != "2fa_ticket": raise HTTPException(401, "Invalid staff challenge")
    user = db.get(User, int(payload["sub"]))
    if not user or user.role not in {"MODERATOR", "OWNER"} or not user.totp_enabled:
        raise HTTPException(403, "Staff MFA required")
    return AuthService.verify_2fa(db, data, request, response)


@router.post("/support/cases", status_code=201)
def create_case(data: CaseCreate, current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    throttle(current.id, "support_case", 8, 3600)
    if data.kind == "BUG" and data.category not in BUG_CATEGORIES:
        raise HTTPException(422, "Invalid bug category")
    if data.diagnostics and data.kind != "BUG":
        raise HTTPException(422, "Diagnostics are only accepted for bug reports")
    row = SupportCase(reporter_id=current.id, **data.model_dump())
    db.add(row)
    db.flush()
    notify_staff(db, "NEW_CASE", "case", row.id, f"New {row.kind.lower()}: {row.title}")
    db.commit()
    db.refresh(row)
    return case_data(row)


@router.get("/support/cases")
def my_cases(current: User = Depends(get_current_user), db: Session = Depends(get_db),
             limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0)):
    rows = db.query(SupportCase).filter_by(reporter_id=current.id).order_by(SupportCase.created_at.desc()).offset(offset).limit(limit).all()
    return {"items": [case_data(row) for row in rows], "total": db.query(SupportCase).filter_by(reporter_id=current.id).count()}


@router.get("/support/cases/{case_id}")
def my_case(case_id: int, current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.query(SupportCase).filter_by(id=case_id, reporter_id=current.id).first()
    if not row:
        raise HTTPException(404, "Case not found")
    messages = db.query(CaseMessage).filter_by(case_id=case_id, internal=False).order_by(CaseMessage.id).all()
    return {**case_data(row), "messages": [message_data(item) for item in messages]}


@router.post("/support/cases/{case_id}/reply", status_code=201)
def user_reply(case_id: int, data: MessageCreate, current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    throttle(current.id, "support_reply", 20, 3600)
    row = db.query(SupportCase).filter_by(id=case_id, reporter_id=current.id).first()
    if not row:
        raise HTTPException(404, "Case not found")
    if data.internal:
        raise HTTPException(403, "Internal notes are staff-only")
    msg = CaseMessage(case_id=row.id, author_id=current.id, body=data.body.strip(), internal=False)
    row.status = "TRIAGED"
    db.add(msg)
    db.flush()
    notify_staff(db, "CASE_REPLY", "case", row.id, f"Reply on case #{row.id}")
    db.commit()
    return message_data(msg)


@router.post("/support/cases/{case_id}/attachments", status_code=201)
async def attach_case_file(case_id: int, file: UploadFile = File(...), current: User = Depends(get_current_user),
                           db: Session = Depends(get_db)):
    throttle(current.id, "support_attachment", 10, 3600)
    row = db.query(SupportCase).filter_by(id=case_id, reporter_id=current.id).first()
    if not row: raise HTTPException(404, "Case not found")
    if row.attachment_url: raise HTTPException(409, "This case already has an attachment")
    content = await file.read(5 * 1024 * 1024 + 1)
    if len(content) > 5 * 1024 * 1024: raise HTTPException(413, "Maximum attachment size is 5 MB")
    if content.startswith(b"\x89PNG\r\n\x1a\n"): mime = "image/png"
    elif content.startswith(b"\xff\xd8\xff"): mime = "image/jpeg"
    elif content.startswith(b"RIFF") and content[8:12] == b"WEBP": mime = "image/webp"
    elif content.startswith(b"%PDF-"): mime = "application/pdf"
    else: raise HTTPException(422, "Only PNG, JPEG, WebP or PDF evidence is supported")
    item = CaseAttachment(case_id=case_id, file_name=(file.filename or "evidence")[:120],
                          mime_type=mime, size=len(content), data=content)
    db.add(item); db.flush()
    row.attachment_url = f"/api/support/cases/{case_id}/attachments/{item.id}"
    db.commit()
    return {"id": item.id, "url": row.attachment_url, "file_name": item.file_name}


@router.get("/support/cases/{case_id}/attachments/{attachment_id}")
def case_attachment(case_id: int, attachment_id: int, request: Request,
                    current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.get(SupportCase, case_id)
    if not row: raise HTTPException(404, "Attachment not found")
    if row.reporter_id != current.id:
        get_staff_user(request, current, db)
    item = db.query(CaseAttachment).filter_by(id=attachment_id, case_id=case_id).first()
    if not item: raise HTTPException(404, "Attachment not found")
    return Response(item.data, media_type="application/octet-stream", headers={
        "Content-Disposition": f"attachment; filename=evidence-{item.id}",
        "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store"})


@router.get("/staff/me")
def staff_me(current: User = Depends(get_staff_user)):
    return {"id": current.id, "username": current.username, "role": current.role}


@router.get("/staff/dashboard")
def dashboard(current: User = Depends(get_staff_user), db: Session = Depends(get_db), days: int = Query(30, ge=1, le=365)):
    since = datetime.now(timezone.utc) - timedelta(days=days)
    case_q = db.query(SupportCase).filter(SupportCase.created_at >= since)
    return {"days": days, "total_users": db.query(User).count(),
            "new_bugs": case_q.filter(SupportCase.kind == "BUG", SupportCase.status == "NEW").count(),
            "open_feedback": case_q.filter(SupportCase.kind.in_(["FEEDBACK", "FEATURE", "COMPLAINT"]),
                SupportCase.status.notin_(["RESOLVED", "CLOSED"])).count(),
            "open_tickets": case_q.filter(SupportCase.kind.in_(["SUPPORT", "SECURITY"]),
                SupportCase.status.notin_(["RESOLVED", "CLOSED"])).count(),
            "pending_reports": db.query(Report).filter(Report.created_at >= since, Report.status.in_(["NEW", "TRIAGED"])).count(),
            "resolved_reports": db.query(Report).filter(Report.created_at >= since, Report.status == "RESOLVED").count(),
            "critical_cases": case_q.filter(SupportCase.priority == "CRITICAL", SupportCase.status.notin_(["RESOLVED", "CLOSED"])).count(),
            "banned_accounts": db.query(User).filter_by(account_state="BANNED").count(),
            "resolved_cases": case_q.filter(SupportCase.status == "RESOLVED").count(),
            "staff_actions": db.query(ModeratorAuditLog).filter(ModeratorAuditLog.created_at >= since).count()}


@router.get("/staff/cases")
def staff_cases(current: User = Depends(get_staff_user), db: Session = Depends(get_db),
                kind: str | None = None, status: str | None = None, q: str | None = None,
                limit: int = Query(30, ge=1, le=100), offset: int = Query(0, ge=0)):
    rows = db.query(SupportCase)
    if kind:
        if kind not in CASE_KINDS: raise HTTPException(422, "Invalid kind")
        rows = rows.filter_by(kind=kind)
    if status:
        if status not in CASE_STATUSES: raise HTTPException(422, "Invalid status")
        rows = rows.filter_by(status=status)
    if q:
        rows = rows.filter(or_(SupportCase.title.ilike(f"%{q[:100]}%"), SupportCase.description.ilike(f"%{q[:100]}%")))
    return {"items": [case_data(row, True) for row in rows.order_by(SupportCase.created_at.desc()).offset(offset).limit(limit)],
            "total": rows.count()}


@router.get("/staff/cases/{case_id}")
def staff_case(case_id: int, current: User = Depends(get_staff_user), db: Session = Depends(get_db)):
    row = db.get(SupportCase, case_id)
    if not row: raise HTTPException(404, "Case not found")
    messages = db.query(CaseMessage).filter_by(case_id=case_id).order_by(CaseMessage.id).all()
    return {**case_data(row, True), "messages": [{**message_data(item), "internal": item.internal} for item in messages]}


@router.patch("/staff/cases/{case_id}")
def update_case(case_id: int, data: CaseUpdate, current: User = Depends(get_staff_user), db: Session = Depends(get_db)):
    row = db.get(SupportCase, case_id)
    if not row: raise HTTPException(404, "Case not found")
    if data.status is not None:
        if data.status not in CASE_STATUSES: raise HTTPException(422, "Invalid status")
        row.status = data.status
    if data.priority is not None:
        if data.priority not in PRIORITIES: raise HTTPException(422, "Invalid priority")
        row.priority = data.priority
    if data.assigned_to_id is not None:
        assignee = db.get(User, data.assigned_to_id)
        if not assignee or assignee.role not in {"MODERATOR", "OWNER"}: raise HTTPException(422, "Invalid assignee")
        row.assigned_to_id = assignee.id
        db.add(StaffNotification(recipient_id=assignee.id, event="ASSIGNED_CASE", target_type="case", target_id=row.id, title=f"Assigned case #{row.id}"))
    if data.duplicate_of_id is not None:
        if data.duplicate_of_id == row.id or not db.get(SupportCase, data.duplicate_of_id): raise HTTPException(422, "Invalid duplicate")
        row.duplicate_of_id = data.duplicate_of_id
    audit(db, current, "CASE_UPDATED", "case", row.id, data.reason)
    db.commit()
    return case_data(row, True)


@router.post("/staff/cases/{case_id}/reply", status_code=201)
def staff_reply(case_id: int, data: MessageCreate, current: User = Depends(get_staff_user), db: Session = Depends(get_db)):
    row = db.get(SupportCase, case_id)
    if not row: raise HTTPException(404, "Case not found")
    msg = CaseMessage(case_id=case_id, author_id=current.id, body=data.body.strip(), internal=data.internal)
    db.add(msg)
    if not data.internal: row.status = "WAITING_FOR_USER"
    audit(db, current, "CASE_NOTE" if data.internal else "CASE_REPLY", "case", case_id, "Staff note" if data.internal else "Response sent")
    db.commit()
    return {**message_data(msg), "internal": msg.internal}


@router.get("/staff/reports")
def reports(current: User = Depends(get_staff_user), db: Session = Depends(get_db),
            status: str | None = None, limit: int = Query(30, ge=1, le=100), offset: int = Query(0, ge=0)):
    rows = db.query(Report)
    if status:
        if status not in REPORT_STATUSES: raise HTTPException(422, "Invalid status")
        rows = rows.filter_by(status=status)
    def serialize(row):
        return {"id": row.id, "reporter_id": row.reporter_id, "entity_type": row.entity_type,
                "entity_id": row.entity_id, "reason": row.reason, "details": row.details,
                "status": row.status, "priority": row.priority, "assigned_to_id": row.assigned_to_id,
                "resolution_reason": row.resolution_reason, "created_at": iso(row.created_at)}
    return {"items": [serialize(row) for row in rows.order_by(Report.created_at.desc()).offset(offset).limit(limit)], "total": rows.count()}


@router.patch("/staff/reports/{report_id}")
def update_report(report_id: int, data: ReportUpdate, current: User = Depends(get_staff_user), db: Session = Depends(get_db)):
    row = db.get(Report, report_id)
    if not row: raise HTTPException(404, "Report not found")
    if data.status not in REPORT_STATUSES: raise HTTPException(422, "Invalid status")
    if data.priority is not None and data.priority not in PRIORITIES: raise HTTPException(422, "Invalid priority")
    if data.assigned_to_id is not None:
        assignee = db.get(User, data.assigned_to_id)
        if not assignee or assignee.role not in {"MODERATOR", "OWNER"}: raise HTTPException(422, "Invalid assignee")
        row.assigned_to_id = assignee.id
    row.status = data.status
    if data.priority: row.priority = data.priority
    row.resolution_reason = data.reason
    audit(db, current, "REPORT_UPDATED", "report", row.id, data.reason)
    db.commit()
    return {"id": row.id, "status": row.status}


@router.get("/staff/users")
def users(current: User = Depends(get_staff_user), db: Session = Depends(get_db), q: str = Query("", max_length=100),
          limit: int = Query(30, ge=1, le=100), offset: int = Query(0, ge=0)):
    rows = db.query(User)
    if q: rows = rows.filter(or_(User.username.ilike(f"%{q}%"), User.email.ilike(f"%{q}%")))
    return {"items": [{"id": row.id, "username": row.username, "display_name": row.display_name,
                       "email": row.email, "role": row.role, "account_state": row.account_state,
                       "is_verified": row.is_verified, "created_at": iso(row.created_at)}
                      for row in rows.order_by(User.id.desc()).offset(offset).limit(limit)], "total": rows.count()}


class EnforcementCreate(BaseModel):
    action: Literal["WARN", "RESTRICT", "BAN", "RESTORE"]
    reason: str = Field(min_length=10, max_length=500)
    days: int | None = Field(default=None, ge=1, le=30)


@router.post("/staff/users/{user_id}/actions", status_code=201)
def enforce(user_id: int, data: EnforcementCreate, request: Request, current: User = Depends(get_staff_user), db: Session = Depends(get_db)):
    target = db.get(User, user_id)
    if not target: raise HTTPException(404, "User not found")
    if target.role != "USER" or target.id == current.id: raise HTTPException(403, "Staff accounts cannot be targeted here")
    if data.action in {"BAN", "RESTORE"} and current.role != "OWNER": raise HTTPException(403, "Owner access required")
    if data.action in {"BAN", "RESTORE"}: get_recent_owner(request, current, db)
    if data.action == "RESTRICT" and (data.days is None or (current.role == "MODERATOR" and data.days > 7)):
        raise HTTPException(422, "A permitted duration is required")
    expires = datetime.now(timezone.utc) + timedelta(days=data.days) if data.action == "RESTRICT" else None
    if data.action == "BAN":
        target.account_state = "BANNED"
    elif data.action == "RESTORE": target.account_state, target.restricted_until = "ACTIVE", None
    elif data.action == "RESTRICT": target.account_state, target.restricted_until = "RESTRICTED", expires
    row = ModerationAction(actor_id=current.id, target_user_id=target.id, action=data.action,
                           reason=data.reason, expires_at=expires)
    db.add(row)
    db.flush()
    audit(db, current, f"USER_{data.action}", "user", target.id, data.reason)
    db.commit()
    return {"id": row.id, "account_state": target.account_state}


class AppealCreate(BaseModel):
    action_id: int
    body: str = Field(min_length=10, max_length=4000)


@router.post("/support/appeals", status_code=201)
def appeal(data: AppealCreate, current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    action = db.get(ModerationAction, data.action_id)
    if not action or action.target_user_id != current.id: raise HTTPException(404, "Action not found")
    if db.query(Appeal.id).filter_by(action_id=action.id).first(): raise HTTPException(409, "Appeal already submitted")
    row = Appeal(action_id=action.id, user_id=current.id, body=data.body)
    db.add(row); db.flush()
    notify_staff(db, "NEW_APPEAL", "appeal", row.id, f"New appeal #{row.id}")
    db.commit()
    return {"id": row.id, "status": row.status}


@router.get("/support/actions")
def my_actions(current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.query(ModerationAction).filter_by(target_user_id=current.id).order_by(ModerationAction.id.desc()).limit(50).all()
    return [{"id": row.id, "action": row.action, "reason": row.reason,
             "expires_at": iso(row.expires_at), "created_at": iso(row.created_at)} for row in rows]


@router.get("/support/appeals")
def my_appeals(current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.query(Appeal).filter_by(user_id=current.id).order_by(Appeal.id.desc()).all()
    return [{"id": row.id, "action_id": row.action_id, "body": row.body,
             "status": row.status, "created_at": iso(row.created_at)} for row in rows]


@router.get("/staff/users/{user_id}/history")
def user_history(user_id: int, current: User = Depends(get_staff_user), db: Session = Depends(get_db)):
    if not db.get(User, user_id): raise HTTPException(404, "User not found")
    actions = db.query(ModerationAction).filter_by(target_user_id=user_id).order_by(ModerationAction.id.desc()).limit(50).all()
    reports = db.query(Report).filter_by(entity_type="user", entity_id=user_id).order_by(Report.id.desc()).limit(50).all()
    return {"actions": [{"id": row.id, "action": row.action, "reason": row.reason,
                         "created_at": iso(row.created_at)} for row in actions],
            "reports": [{"id": row.id, "reason": row.reason, "status": row.status,
                         "created_at": iso(row.created_at)} for row in reports]}


@router.get("/staff/appeals")
def staff_appeals(current: User = Depends(get_staff_user), db: Session = Depends(get_db),
                  limit: int = Query(30, ge=1, le=100), offset: int = Query(0, ge=0)):
    rows = db.query(Appeal).order_by(Appeal.id.desc())
    return {"items": [{"id": row.id, "action_id": row.action_id, "user_id": row.user_id,
                       "body": row.body, "status": row.status, "created_at": iso(row.created_at)}
                      for row in rows.offset(offset).limit(limit)], "total": rows.count()}


class AppealDecision(BaseModel):
    status: Literal["ESCALATED", "DENIED", "APPROVED"]
    reason: str = Field(min_length=10, max_length=500)


@router.patch("/staff/appeals/{appeal_id}")
def decide_appeal(appeal_id: int, data: AppealDecision, request: Request,
                  current: User = Depends(get_staff_user), db: Session = Depends(get_db)):
    row = db.get(Appeal, appeal_id)
    if not row: raise HTTPException(404, "Appeal not found")
    if row.status not in {"OPEN", "ESCALATED"}: raise HTTPException(409, "Appeal already decided")
    if data.status == "APPROVED":
        if current.role != "OWNER": raise HTTPException(403, "Owner access required")
        get_recent_owner(request, current, db)
        target = db.get(User, row.user_id)
        target.account_state = "ACTIVE"
        target.restricted_until = None
    row.status = data.status
    audit(db, current, "APPEAL_DECIDED", "appeal", row.id, data.reason)
    db.commit()
    return {"id": row.id, "status": row.status}


@router.get("/staff/notifications")
def notifications(current: User = Depends(get_staff_user), db: Session = Depends(get_db),
                  limit: int = Query(30, ge=1, le=100)):
    rows = db.query(StaffNotification).filter_by(recipient_id=current.id).order_by(StaffNotification.id.desc()).limit(limit).all()
    return [{"id": row.id, "event": row.event, "title": row.title, "target_type": row.target_type,
             "target_id": row.target_id, "read_at": iso(row.read_at), "created_at": iso(row.created_at)} for row in rows]


@router.post("/staff/notifications/{notification_id}/read")
def read_notification(notification_id: int, current: User = Depends(get_staff_user), db: Session = Depends(get_db)):
    row = db.query(StaffNotification).filter_by(id=notification_id, recipient_id=current.id).first()
    if not row: raise HTTPException(404, "Notification not found")
    row.read_at = datetime.now(timezone.utc)
    db.commit()
    return {"read": True}


@router.get("/staff/audit-logs")
def audit_logs(current: User = Depends(get_owner_user), db: Session = Depends(get_db),
               limit: int = Query(30, ge=1, le=100), offset: int = Query(0, ge=0)):
    rows = db.query(ModeratorAuditLog).order_by(ModeratorAuditLog.id.desc()).offset(offset).limit(limit).all()
    return {"items": [{"id": row.id, "actor_id": row.actor_id, "action": row.action,
                      "target_type": row.target_type, "target_id": row.target_id, "result": row.result,
                      "reason": row.reason, "created_at": iso(row.created_at)} for row in rows],
            "total": db.query(ModeratorAuditLog).count()}


class InviteCreate(BaseModel):
    email: str = Field(min_length=3, max_length=120)


@router.post("/staff/moderators/invite", status_code=201)
def invite(data: InviteCreate, current: User = Depends(get_recent_owner), db: Session = Depends(get_db)):
    from app.utils.validators import validate_email
    email = validate_email(data.email)
    target = db.query(User).filter_by(email=email).first()
    if not target or not target.is_verified or not target.totp_enabled or target.role != "USER":
        raise HTTPException(422, "Invitee needs a verified account with authenticator MFA")
    token = secrets.token_urlsafe(32)
    row = StaffInvitation(email=email, token_hash=hash_token(token), invited_by_id=current.id,
                          expires_at=datetime.now(timezone.utc) + timedelta(hours=24))
    db.add(row); db.flush()
    audit(db, current, "MODERATOR_INVITED", "user", target.id, "Invitation created")
    db.commit()
    return {"invitation_id": row.id, "invite_token": token, "expires_at": iso(row.expires_at)}


class AcceptInvite(BaseModel):
    token: str


@router.post("/staff/moderators/accept")
def accept_invite(data: AcceptInvite, current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.query(StaffInvitation).filter_by(token_hash=hash_token(data.token), email=current.email).first()
    if not row or row.accepted_at or row.expires_at.replace(tzinfo=timezone.utc) < datetime.now(timezone.utc):
        raise HTTPException(400, "Invalid or expired invitation")
    if not current.is_verified or not current.totp_enabled or current.role != "USER": raise HTTPException(403, "Verified MFA account required")
    current.role = "MODERATOR"
    row.accepted_at = datetime.now(timezone.utc)
    db.query(UserSession).filter_by(user_id=current.id, revoked=False).update({"revoked": True, "revoked_at": datetime.now(timezone.utc)})
    audit(db, current, "MODERATOR_ACCEPTED", "user", current.id, "Invitation accepted")
    db.commit()
    return {"message": "Moderator access enabled. Sign in again with MFA."}


@router.delete("/staff/moderators/{user_id}")
def remove_moderator(user_id: int, current: User = Depends(get_recent_owner), db: Session = Depends(get_db)):
    target = db.get(User, user_id)
    if not target or target.role != "MODERATOR": raise HTTPException(404, "Moderator not found")
    target.role = "USER"
    db.query(UserSession).filter_by(user_id=target.id, revoked=False).update({"revoked": True, "revoked_at": datetime.now(timezone.utc)})
    audit(db, current, "MODERATOR_REMOVED", "user", target.id, "Privileges revoked")
    db.commit()
    return {"message": "Moderator privileges revoked"}
