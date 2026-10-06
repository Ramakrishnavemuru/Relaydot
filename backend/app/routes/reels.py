"""Dedicated short-video API using the existing identity, social graph and messaging systems."""
import uuid
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Literal
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User
from app.models.conversation import ConversationMember
from app.models.reel import (Reel, ReelLike, ReelBookmark, ReelComment,
    ReelCommentLike, ReelView, ReelShare, ReelMention)
from app.models.social import Report
from app.schemas.message import MessageCreate
from app.security.dependencies import get_current_user
from app.services.message_service import MessageService
from app.services.rate_limit import throttle
from app.services.reel_processor import MEDIA_ROOT
from app.services.reel_processor import command as video_command
from app.services.reel_service import (feed, get_visible, index_caption, serialize,
    valid_signature, visible_query)
from app.utils.helpers import sanitize_text

router = APIRouter(prefix="/reels", tags=["Reels"])
Visibility = Literal["EVERYONE", "FOLLOWERS", "FRIENDS", "ONLY_ME"]
MAX_BYTES = 60 * 1024 * 1024


class ReelEdit(BaseModel):
    caption: str | None = Field(default=None, max_length=2200)
    visibility: Visibility | None = None
    allow_comments: bool | None = None
    allow_download: bool | None = None
    publish: bool = False
    archive: bool | None = None


class ReelCommentCreate(BaseModel):
    content: str = Field(..., min_length=1, max_length=2000)
    parent_id: int | None = None


class ReelViewEvent(BaseModel):
    session_id: str = Field(..., min_length=8, max_length=36, pattern=r"^[A-Za-z0-9_-]+$")
    watched_ms: int = Field(..., ge=0, le=180000)
    completed: bool = False


class ReelShareCreate(BaseModel):
    conversation_id: int


def own_reel(db: Session, public_id: str, user_id: int) -> Reel:
    reel = db.query(Reel).filter_by(public_id=public_id, creator_id=user_id).first()
    if not reel or reel.deleted_at:
        raise HTTPException(404, "Reel not found")
    return reel


async def reel_notify(db, recipient_id, actor_id, kind, reel):
    from app.routes.social import notify
    await notify(db, recipient_id, actor_id, kind, "reel", reel.id)


@router.post("", status_code=201)
async def create_reel(video: UploadFile = File(...), caption: str = Form(""),
    visibility: Visibility = Form("EVERYONE"), publish: bool = Form(True),
    allow_comments: bool = Form(True), allow_download: bool = Form(False),
    current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    throttle(current.id, "reel_upload", 5, 3600)
    if len(caption) > 2200:
        raise HTTPException(400, "Caption is too long")
    name = (video.filename or "").lower()
    ext = name.rsplit(".", 1)[-1] if "." in name else ""
    if (ext, video.content_type) not in {("mp4", "video/mp4"), ("webm", "video/webm")}:
        raise HTTPException(400, "Choose an MP4 or WebM video")
    public_id = uuid.uuid4().hex
    folder = MEDIA_ROOT / public_id
    folder.mkdir(mode=0o700, parents=True, exist_ok=False)
    source = folder / "source"
    size = 0
    first = b""
    try:
        with source.open("wb") as target:
            while chunk := await video.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_BYTES:
                    raise HTTPException(413, "Reel video exceeds 60 MB")
                if not first:
                    first = chunk[:16]
                target.write(chunk)
        valid_mp4 = ext == "mp4" and len(first) >= 8 and first[4:8] == b"ftyp"
        valid_webm = ext == "webm" and first.startswith(b"\x1a\x45\xdf\xa3")
        if not size or not (valid_mp4 or valid_webm):
            raise HTTPException(400, "Video contents do not match its format")
        reel = Reel(public_id=public_id, creator_id=current.id,
            caption=sanitize_text(caption.strip()), visibility=visibility,
            publish_requested=publish, allow_comments=allow_comments,
            allow_download=allow_download, source_path=str(source), status="PROCESSING")
        db.add(reel)
        db.commit()
        db.refresh(reel)
        index_caption(db, reel)
        return serialize(db, reel, current.id)
    except Exception:
        source.unlink(missing_ok=True)
        folder.rmdir()
        raise


@router.get("")
def list_reels(mode: Literal["for_you", "following", "trending", "new", "saved", "mine"] = "for_you",
    q: str = Query("", max_length=100), creator_id: int | None = None,
    limit: int = Query(8, ge=1, le=20), offset: int = Query(0, ge=0),
    current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if mode == "mine":
        rows = db.query(Reel).filter_by(creator_id=current.id).filter(Reel.deleted_at.is_(None))\
            .order_by(Reel.created_at.desc()).offset(offset).limit(limit+1).all()
    elif mode == "saved":
        rows = visible_query(db, current.id)\
            .join(ReelBookmark, ReelBookmark.reel_id == Reel.id).filter(ReelBookmark.user_id == current.id)\
            .order_by(ReelBookmark.created_at.desc()).offset(offset).limit(limit+1).all()
    elif creator_id:
        rows = visible_query(db, current.id)\
            .filter(Reel.creator_id == creator_id).order_by(Reel.published_at.desc())\
            .offset(offset).limit(limit+1).all()
    else:
        rows = feed(db, current.id, mode, limit+1, offset, q.strip())
    items = rows[:limit]
    return {"items":[serialize(db, reel, current.id) for reel in items],
        "next_offset":offset+limit if len(rows)>limit else None}


@router.get("/{public_id}/media/{kind}")
def reel_media(public_id: str, kind: Literal["video", "thumbnail"], viewer: int,
    expires: int, signature: str, db: Session = Depends(get_db)):
    if not valid_signature(public_id, viewer, kind, expires, signature):
        raise HTTPException(403, "Media link expired")
    reel = get_visible(db, public_id, viewer)
    path = reel.video_path if kind == "video" else reel.thumbnail_path
    if not path or not Path(path).is_file() or not Path(path).resolve().is_relative_to(MEDIA_ROOT):
        raise HTTPException(404, "Media not found")
    return FileResponse(path, media_type="video/mp4" if kind == "video" else "image/jpeg",
        headers={"Cache-Control":"private, max-age=300", "X-Content-Type-Options":"nosniff"})


@router.get("/id/{reel_id}")
def get_reel_by_id(reel_id: int, current: User = Depends(get_current_user),
    db: Session = Depends(get_db)):
    reel = db.get(Reel, reel_id)
    if not reel:
        raise HTTPException(404, "Reel not found")
    return serialize(db, get_visible(db, reel.public_id, current.id), current.id)


@router.get("/{public_id}")
def get_reel(public_id: str, current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return serialize(db, get_visible(db, public_id, current.id), current.id)


@router.patch("/{public_id}")
async def edit_reel(public_id: str, data: ReelEdit, current: User = Depends(get_current_user),
    db: Session = Depends(get_db)):
    reel = own_reel(db, public_id, current.id)
    if reel.status == "REMOVED":
        raise HTTPException(400, "Reel was removed")
    was_published = reel.status == "PUBLISHED"
    was_archived = reel.status == "ARCHIVED"
    if data.caption is not None:
        reel.caption = sanitize_text(data.caption.strip())
    if data.visibility is not None:
        reel.visibility = data.visibility
    if data.allow_comments is not None:
        reel.allow_comments = data.allow_comments
    if data.allow_download is not None:
        reel.allow_download = data.allow_download
    if data.archive is not None:
        if data.archive and reel.status == "PUBLISHED":
            reel.status = "ARCHIVED"
        elif not data.archive and reel.status == "ARCHIVED":
            reel.status = "PUBLISHED"
        else:
            raise HTTPException(400,"Only published Reels can be archived or restored")
    if data.publish:
        if reel.status == "READY":
            reel.status = "PUBLISHED"
            reel.published_at = datetime.now(timezone.utc)
        elif reel.status == "PROCESSING":
            reel.publish_requested = True
        else:
            raise HTTPException(400, "Reel is not ready to publish")
    db.commit()
    mentioned = []
    if data.caption is not None:
        mentioned = index_caption(db, reel)
    if not was_published and not was_archived and reel.status == "PUBLISHED":
        mentioned = [row[0] for row in db.query(ReelMention.user_id).filter_by(reel_id=reel.id)]
    if reel.status == "PUBLISHED":
        for user_id in mentioned:
            try:
                get_visible(db,reel.public_id,user_id)
            except HTTPException:
                continue
            await reel_notify(db,user_id,current.id,"reel_mention",reel)
    return serialize(db, reel, current.id)


@router.delete("/{public_id}")
def delete_reel(public_id: str, current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    reel = own_reel(db, public_id, current.id)
    reel.deleted_at = datetime.now(timezone.utc)
    reel.status = "REMOVED"
    db.commit()
    for path in (reel.source_path, reel.video_path, reel.thumbnail_path):
        if path and Path(path).resolve().is_relative_to(MEDIA_ROOT):
            Path(path).unlink(missing_ok=True)
    return {"deleted":True}


@router.post("/{public_id}/cover")
async def choose_cover(public_id: str, time_seconds: float = Form(...),
    current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    reel = own_reel(db,public_id,current.id)
    if reel.status not in {"READY","PUBLISHED"} or not reel.video_path or reel.duration is None:
        raise HTTPException(400,"Reel is not ready")
    if not 0 <= time_seconds < reel.duration:
        raise HTTPException(400,"Choose a frame within the Reel")
    temporary = MEDIA_ROOT / reel.public_id / "cover-new.jpg"
    try:
        await video_command("ffmpeg","-hide_banner","-loglevel","error","-nostdin","-y",
            "-ss",str(time_seconds),"-i",reel.video_path,"-frames:v","1",
            "-vf","scale=360:-2",str(temporary),timeout=30)
        os.replace(temporary,reel.thumbnail_path)
        reel.updated_at = datetime.now(timezone.utc)
        db.commit()
        return serialize(db,reel,current.id)
    finally:
        temporary.unlink(missing_ok=True)


@router.post("/{public_id}/cover-upload")
async def upload_cover(public_id: str, image: UploadFile = File(...),
    current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    reel = own_reel(db,public_id,current.id)
    if reel.status not in {"READY","PUBLISHED"} or not reel.thumbnail_path:
        raise HTTPException(400,"Reel is not ready")
    ext = (image.filename or "").rsplit(".",1)[-1].lower()
    if (ext,image.content_type) not in {("png","image/png"),("jpg","image/jpeg"),
        ("jpeg","image/jpeg"),("webp","image/webp")}:
        raise HTTPException(400,"Choose a PNG, JPEG, or WebP cover")
    content = await image.read(5*1024*1024+1)
    if len(content)>5*1024*1024:
        raise HTTPException(413,"Cover exceeds 5 MB")
    signatures = {"png":content.startswith(b"\x89PNG\r\n\x1a\n"),
        "jpg":content.startswith(b"\xff\xd8\xff"),
        "jpeg":content.startswith(b"\xff\xd8\xff"),
        "webp":content.startswith(b"RIFF") and content[8:12]==b"WEBP"}
    if not signatures[ext]:
        raise HTTPException(400,"Cover contents do not match its format")
    source = MEDIA_ROOT / reel.public_id / f"cover-source.{ext}"
    temporary = MEDIA_ROOT / reel.public_id / "cover-new.jpg"
    try:
        source.write_bytes(content)
        await video_command("ffmpeg","-hide_banner","-loglevel","error","-nostdin","-y",
            "-i",str(source),"-frames:v","1","-vf","scale=360:-2",str(temporary),timeout=30)
        os.replace(temporary,reel.thumbnail_path)
        reel.updated_at = datetime.now(timezone.utc)
        db.commit()
        return serialize(db,reel,current.id)
    finally:
        source.unlink(missing_ok=True)
        temporary.unlink(missing_ok=True)


@router.post("/{public_id}/like")
async def like_reel(public_id: str, current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    throttle(current.id, "reel_like", 60)
    reel = get_visible(db, public_id, current.id)
    if not db.query(ReelLike.id).filter_by(reel_id=reel.id,user_id=current.id).first():
        db.add(ReelLike(reel_id=reel.id,user_id=current.id)); db.commit()
        await reel_notify(db, reel.creator_id, current.id, "reel_like", reel)
    return serialize(db, reel, current.id)


@router.delete("/{public_id}/like")
def unlike_reel(public_id: str, current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    reel = get_visible(db, public_id, current.id)
    db.query(ReelLike).filter_by(reel_id=reel.id,user_id=current.id).delete(); db.commit()
    return serialize(db, reel, current.id)


@router.post("/{public_id}/bookmark")
def bookmark_reel(public_id: str, current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    reel = get_visible(db, public_id, current.id)
    if not db.query(ReelBookmark.id).filter_by(reel_id=reel.id,user_id=current.id).first():
        db.add(ReelBookmark(reel_id=reel.id,user_id=current.id)); db.commit()
    return serialize(db, reel, current.id)


@router.delete("/{public_id}/bookmark")
def unbookmark_reel(public_id: str, current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    reel = get_visible(db, public_id, current.id)
    db.query(ReelBookmark).filter_by(reel_id=reel.id,user_id=current.id).delete(); db.commit()
    return serialize(db, reel, current.id)


def comment_dict(db, comment, viewer_id):
    user = db.get(User, comment.author_id)
    return {"id":comment.id,"reel_id":comment.reel_id,"parent_id":comment.parent_id,
        "content":comment.content,"author":user.to_dict(False),
        "created_at":comment.created_at.isoformat(),
        "pinned":comment.pinned_at is not None,
        "likes_count":db.query(func.count(ReelCommentLike.id)).filter_by(comment_id=comment.id).scalar() or 0,
        "liked":db.query(ReelCommentLike.id).filter_by(comment_id=comment.id,user_id=viewer_id).first() is not None}


@router.get("/{public_id}/comments")
def reel_comments(public_id: str, limit: int = Query(20,ge=1,le=50), offset: int = Query(0,ge=0),
    current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    reel = get_visible(db, public_id, current.id)
    rows = db.query(ReelComment).filter_by(reel_id=reel.id,deleted_at=None)\
        .order_by(ReelComment.pinned_at.desc(),ReelComment.created_at, ReelComment.id)\
        .offset(offset).limit(limit+1).all()
    return {"items":[comment_dict(db,c,current.id) for c in rows[:limit]],
        "next_offset":offset+limit if len(rows)>limit else None}


@router.post("/{public_id}/comments", status_code=201)
async def add_comment(public_id: str, data: ReelCommentCreate,
    current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    throttle(current.id, "reel_comment", 20)
    reel = get_visible(db, public_id, current.id)
    if not reel.allow_comments or reel.status != "PUBLISHED":
        raise HTTPException(403, "Comments are disabled")
    parent = None
    if data.parent_id:
        parent = db.get(ReelComment,data.parent_id)
        if not parent or parent.reel_id != reel.id or parent.deleted_at or parent.parent_id:
            raise HTTPException(400, "Reply target is unavailable")
    comment = ReelComment(reel_id=reel.id,author_id=current.id,parent_id=data.parent_id,
        content=sanitize_text(data.content.strip()))
    db.add(comment); db.commit(); db.refresh(comment)
    await reel_notify(db, reel.creator_id, current.id, "reel_comment", reel)
    if parent and parent.author_id != reel.creator_id:
        await reel_notify(db, parent.author_id, current.id, "reel_reply", reel)
    return comment_dict(db,comment,current.id)


@router.delete("/{public_id}/comments/{comment_id}")
def delete_comment(public_id: str, comment_id: int, current: User = Depends(get_current_user),
    db: Session = Depends(get_db)):
    reel = get_visible(db, public_id, current.id)
    comment = db.get(ReelComment,comment_id)
    if not comment or comment.reel_id != reel.id or comment.deleted_at:
        raise HTTPException(404, "Comment not found")
    if current.id not in {comment.author_id,reel.creator_id}:
        raise HTTPException(403, "Cannot remove this comment")
    comment.deleted_at = datetime.now(timezone.utc); db.commit()
    return {"deleted":True}


@router.post("/{public_id}/comments/{comment_id}/pin")
def pin_comment(public_id: str, comment_id: int, current: User = Depends(get_current_user),
    db: Session = Depends(get_db)):
    reel = own_reel(db,public_id,current.id)
    comment = db.get(ReelComment,comment_id)
    if not comment or comment.reel_id != reel.id or comment.deleted_at or comment.parent_id:
        raise HTTPException(404,"Comment not found")
    db.query(ReelComment).filter_by(reel_id=reel.id).update({"pinned_at":None},synchronize_session=False)
    comment.pinned_at = datetime.now(timezone.utc)
    db.commit()
    return comment_dict(db,comment,current.id)


@router.delete("/{public_id}/comments/{comment_id}/pin")
def unpin_comment(public_id: str, comment_id: int, current: User = Depends(get_current_user),
    db: Session = Depends(get_db)):
    reel = own_reel(db,public_id,current.id)
    comment = db.get(ReelComment,comment_id)
    if not comment or comment.reel_id != reel.id or comment.deleted_at:
        raise HTTPException(404,"Comment not found")
    comment.pinned_at = None
    db.commit()
    return comment_dict(db,comment,current.id)


@router.post("/{public_id}/comments/{comment_id}/like")
def like_comment(public_id: str, comment_id: int, current: User = Depends(get_current_user),
    db: Session = Depends(get_db)):
    reel = get_visible(db, public_id, current.id)
    comment = db.get(ReelComment,comment_id)
    if not comment or comment.reel_id != reel.id or comment.deleted_at:
        raise HTTPException(404, "Comment not found")
    if not db.query(ReelCommentLike.id).filter_by(comment_id=comment_id,user_id=current.id).first():
        db.add(ReelCommentLike(comment_id=comment_id,user_id=current.id)); db.commit()
    return comment_dict(db,comment,current.id)


@router.delete("/{public_id}/comments/{comment_id}/like")
def unlike_comment(public_id: str, comment_id: int, current: User = Depends(get_current_user),
    db: Session = Depends(get_db)):
    reel = get_visible(db, public_id, current.id)
    comment = db.get(ReelComment,comment_id)
    if not comment or comment.reel_id != reel.id or comment.deleted_at:
        raise HTTPException(404, "Comment not found")
    db.query(ReelCommentLike).filter_by(comment_id=comment_id,user_id=current.id).delete(); db.commit()
    return comment_dict(db,comment,current.id)


@router.post("/{public_id}/view")
def record_view(public_id: str, data: ReelViewEvent,
    current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    throttle(current.id, "reel_view", 60)
    reel = get_visible(db, public_id, current.id)
    if reel.status != "PUBLISHED" or data.watched_ms < 3000:
        return {"counted":False}
    view = db.query(ReelView).filter_by(reel_id=reel.id,user_id=current.id,
        session_id=data.session_id).first()
    if not view:
        view = db.query(ReelView).filter(ReelView.reel_id == reel.id,
            ReelView.user_id == current.id,
            ReelView.created_at >= datetime.now(timezone.utc)-timedelta(hours=24)).first()
    if not view:
        view = ReelView(reel_id=reel.id,user_id=current.id,session_id=data.session_id)
        db.add(view)
    view.watched_ms = max(view.watched_ms or 0,data.watched_ms)
    view.completed = bool(view.completed or data.completed)
    db.commit()
    return {"counted":True}


@router.post("/{public_id}/share")
async def share_reel(public_id: str, data: ReelShareCreate,
    current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    throttle(current.id, "reel_share", 20)
    reel = get_visible(db, public_id, current.id)
    if reel.status != "PUBLISHED":
        raise HTTPException(400, "Reel is not published")
    if not db.query(ConversationMember.id).filter_by(conversation_id=data.conversation_id,
        user_id=current.id).first():
        raise HTTPException(403, "Not a conversation member")
    creator = db.get(User,reel.creator_id)
    url = f"/reels.html?id={reel.public_id}"
    content = f"Shared Reel by @{creator.username}\n{reel.caption[:120]}\n{url}"
    await MessageService.send_message(db,current.id,
        MessageCreate(conversation_id=data.conversation_id,content=content))
    db.add(ReelShare(reel_id=reel.id,user_id=current.id,
        conversation_id=data.conversation_id)); db.commit()
    await reel_notify(db,reel.creator_id,current.id,"reel_share",reel)
    return {"shared":True}


@router.get("/{public_id}/analytics")
def reel_analytics(public_id: str, current: User = Depends(get_current_user),
    db: Session = Depends(get_db)):
    reel = own_reel(db,public_id,current.id)
    views = db.query(ReelView).filter_by(reel_id=reel.id).all()
    return {"views":len(views),"unique_viewers":len({v.user_id for v in views}),
        "watch_time_ms":sum(v.watched_ms for v in views),
        "average_watch_ms":round(sum(v.watched_ms for v in views)/len(views)) if views else 0,
        "completion_rate":round(sum(v.completed for v in views)/len(views),3) if views else 0,
        "likes":db.query(func.count(ReelLike.id)).filter_by(reel_id=reel.id).scalar() or 0,
        "comments":db.query(func.count(ReelComment.id)).filter_by(reel_id=reel.id,deleted_at=None).scalar() or 0,
        "shares":db.query(func.count(ReelShare.id)).filter_by(reel_id=reel.id).scalar() or 0,
        "saves":db.query(func.count(ReelBookmark.id)).filter_by(reel_id=reel.id).scalar() or 0}


@router.post("/{public_id}/report")
def report_reel(public_id: str, reason: Literal["spam","harassment","impersonation","inappropriate","scam","other"] = Form(...),
    details: str = Form(""), current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    throttle(current.id,"reel_report",10,3600)
    reel = get_visible(db,public_id,current.id)
    if len(details)>500:
        raise HTTPException(400,"Report details are too long")
    if not db.query(Report.id).filter_by(reporter_id=current.id,entity_type="reel",entity_id=reel.id).first():
        db.add(Report(reporter_id=current.id,entity_type="reel",entity_id=reel.id,
            reason=reason,details=details)); db.commit()
    return {"reported":True}


@router.post("/{public_id}/comments/{comment_id}/report")
def report_reel_comment(public_id: str, comment_id: int,
    reason: Literal["spam","harassment","impersonation","inappropriate","scam","other"] = Form(...),
    details: str = Form(""), current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    throttle(current.id,"reel_report",10,3600)
    reel = get_visible(db,public_id,current.id)
    comment = db.get(ReelComment,comment_id)
    if not comment or comment.reel_id != reel.id or comment.deleted_at:
        raise HTTPException(404,"Comment not found")
    if len(details)>500:
        raise HTTPException(400,"Report details are too long")
    if not db.query(Report.id).filter_by(reporter_id=current.id,entity_type="reel_comment",entity_id=comment.id).first():
        db.add(Report(reporter_id=current.id,entity_type="reel_comment",entity_id=comment.id,
            reason=reason,details=sanitize_text(details))); db.commit()
    return {"reported":True}
