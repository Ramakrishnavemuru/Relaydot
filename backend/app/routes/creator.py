"""Owner-only professional account, analytics and scheduling APIs."""
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.creator import ScheduledPost
from app.models.reel import Reel
from app.models.social import Follow, Post, PostCollaborator
from app.models.staff import ModerationAction
from app.models.story import Story
from app.models.user import User
from app.schemas.social import PostCreate
from app.security.dependencies import get_current_user
from app.services import creator_analytics as analytics
from app.services.creator_events import record_daily_view, record_profile_visit
from app.services.rate_limit import throttle

router = APIRouter(prefix="/creator", tags=["Creator"])
CATEGORIES = {"Digital Creator", "Artist", "Gamer", "Photographer", "Educator",
              "Technology", "Blogger", "Entrepreneur", "Other"}


class AccountSwitch(BaseModel):
    account_type: Literal["PERSONAL", "CREATOR"]
    category: str | None = Field(default=None, max_length=40)
    confirm_public: bool = False
    private_when_personal: bool = False


class CreatorProfileConfig(BaseModel):
    category: str | None = Field(default=None, max_length=40)
    contact_enabled: bool | None = None


class ScheduleCreate(BaseModel):
    post: PostCreate
    scheduled_at: datetime


class ScheduleUpdate(BaseModel):
    post: PostCreate | None = None
    scheduled_at: datetime | None = None


def require_creator(current: User = Depends(get_current_user)) -> User:
    if current.account_type != "CREATOR" or current.is_private:
        raise HTTPException(403, "Switch to a public creator account to use this dashboard")
    return current


def period(days: int = Query(30, ge=1, le=365), start: date | None = None,
           end: date | None = None) -> tuple[date, date]:
    today = datetime.now(timezone.utc).date()
    if bool(start) != bool(end):
        raise HTTPException(400, "Choose both custom start and end dates")
    if start is None:
        end = today
        start = today - timedelta(days=days - 1)
    if end > today or start > end or (end - start).days > 364:
        raise HTTPException(400, "Choose up to 365 days ending today or earlier")
    return start, end


def compare(current: int | float | None, previous: int | float | None):
    if current is None or previous is None or previous == 0:
        return None
    return round((current - previous) * 100 / previous, 2)


def schedule_time(value: datetime) -> datetime:
    if value.tzinfo is None:
        raise HTTPException(400, "Schedule time must include a timezone")
    value = value.astimezone(timezone.utc)
    now = datetime.now(timezone.utc)
    if not now + timedelta(minutes=1) <= value <= now + timedelta(days=90):
        raise HTTPException(400, "Schedule between one minute and 90 days ahead")
    return value


def validate_scheduled_post(db: Session, user: User, post: PostCreate):
    from app.routes.social import media_url_valid, user_or_404
    from app.routes.post_media import media_id, validate_reference
    if not post.content.strip() and not post.media_url and not post.poll_options:
        raise HTTPException(400, "Add text, media, or a poll")
    if bool(post.media_url) != bool(post.media_type) or (post.media_url and not media_url_valid(post.media_url, post.media_type)):
        raise HTTPException(400, "Choose an uploaded image or video")
    if post.media_url and not media_id(post.media_url):
        raise HTTPException(400, "Upload post media through the private post uploader")
    if post.media_url:
        validate_reference(db, user.id, post.media_url, post.media_type)
    if post.community_id or post.quote_of_id or post.thread_parent_id:
        raise HTTPException(400, "Schedule a standalone post")
    if user.id in post.collaborator_ids or len(post.collaborator_ids) != len(set(post.collaborator_ids)):
        raise HTTPException(400, "Choose unique collaborators other than yourself")
    for user_id in post.collaborator_ids:
        user_or_404(db, user_id, user.id)


def schedule_dict(item: ScheduledPost) -> dict:
    return {"id": item.id, "scheduled_at": item.scheduled_at.isoformat(),
            "status": item.status, "attempts": item.attempts, "error": item.error,
            "post_id": item.post_id, "post": item.payload,
            "created_at": item.created_at.isoformat()}


@router.post("/account")
def switch_account(data: AccountSwitch, current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    throttle(current.id, "creator_switch", 10, 3600)
    if data.account_type == "CREATOR":
        if data.category not in CATEGORIES:
            raise HTTPException(400, "Choose a creator category")
        if current.is_private and not data.confirm_public:
            raise HTTPException(409, "Confirm that switching will make your account public")
        current.is_private = False
        if current.account_type != "CREATOR":
            current.creator_enabled_at = datetime.now(timezone.utc)
        current.account_type = "CREATOR"
        current.creator_category = data.category
    else:
        current.account_type = "PERSONAL"
        current.is_private = data.private_when_personal
        current.creator_contact_enabled = False
        db.query(ScheduledPost).filter(ScheduledPost.owner_id == current.id,
            ScheduledPost.status.in_(("SCHEDULED", "FAILED"))).update(
            {"status": "PAUSED"}, synchronize_session=False)
    db.commit()
    return current.to_dict(True)


@router.patch("/profile")
def creator_profile(data: CreatorProfileConfig, current: User = Depends(require_creator), db: Session = Depends(get_db)):
    if data.category is not None:
        if data.category not in CATEGORIES:
            raise HTTPException(400, "Choose a creator category")
        current.creator_category = data.category
    if data.contact_enabled is not None:
        current.creator_contact_enabled = data.contact_enabled
    db.commit()
    return current.to_dict(True)


@router.post("/posts/{post_id}/view")
def view_post(post_id: int, current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    from app.services.feed_service import FeedService
    throttle(current.id, "creator_post_view", 120, 60)
    post = db.get(Post, post_id)
    if not post or not FeedService.can_view(db, post, current.id):
        raise HTTPException(404, "Post not found")
    if db.query(PostCollaborator.id).filter_by(post_id=post.id, user_id=current.id, status="ACCEPTED").first():
        return {"counted": False}
    return {"counted": record_daily_view(db, post.author_id, current.id, "POST", post.id)}


@router.post("/profiles/{user_id}/visit")
def visit_profile(user_id: int, current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    from app.services.user_service import UserService
    throttle(current.id, "creator_profile_visit", 80, 60)
    target = db.get(User, user_id)
    if not target or UserService.is_blocked(db, current.id, user_id):
        raise HTTPException(404, "Profile not found")
    return {"counted": record_profile_visit(db, user_id, current.id)}


@router.get("/summary")
def summary(start: date | None = None, end: date | None = None,
            days: int = Query(30, ge=1, le=365), current: User = Depends(require_creator),
            db: Session = Depends(get_db)):
    first, last = period(days, start, end)
    width = (last - first).days + 1
    prior_first, prior_last = first - timedelta(days=width), first - timedelta(days=1)
    values = analytics.period_metrics(db, current.id, first, last)
    previous = analytics.period_metrics(db, current.id, prior_first, prior_last)
    followers = db.query(func.count(Follow.id)).filter(Follow.following_id == current.id).scalar() or 0
    net = values["followers_gained"] - values["followers_lost"]
    prior_followers = followers - net if current.creator_enabled_at and current.creator_enabled_at.date() <= first else None
    summary_metrics = {key: {"value": values[key], "previous": previous[key],
                             "change_percent": compare(values[key], previous[key])}
                       for key in ("views", "accounts_reached", "profile_visits")}
    summary_metrics["followers"] = {"value": followers, "previous": prior_followers,
                                    "change_percent": compare(followers, prior_followers)}
    summary_metrics["net_followers"] = {"value": net, "previous": previous["followers_gained"] - previous["followers_lost"],
                                        "change_percent": None}
    series = analytics.daily(db, current.id, first, last)
    trend = [{"date": (first + timedelta(days=i)).isoformat(),
              "views": series.get((first + timedelta(days=i)).isoformat(), {}).get("views", 0)} for i in range(width)]
    return {"start": first.isoformat(), "end": last.isoformat(), "metrics": summary_metrics,
            "trend": trend, "coverage_note": "Post and profile views and follow changes are recorded from creator activation. Earlier unrecorded activity is not estimated."}


@router.get("/performance")
def performance(metric: str = "views", grain: Literal["daily", "weekly", "monthly"] = "daily",
                start: date | None = None, end: date | None = None,
                days: int = Query(30, ge=1, le=365), current: User = Depends(require_creator),
                db: Session = Depends(get_db)):
    if metric not in analytics.METRICS:
        raise HTTPException(400, "Unsupported metric")
    first, last = period(days, start, end)
    width = (last - first).days + 1
    prior_first, prior_last = first - timedelta(days=width), first - timedelta(days=1)
    series = analytics.daily(db, current.id, first, last)
    unique_daily = analytics.daily_reach(db, current.id, first, last) if metric in {"unique_viewers", "accounts_reached"} and grain == "daily" else {}
    buckets = {}
    bucket_days = {}
    for i in range(width):
        day = first + timedelta(days=i)
        key = day.isoformat() if grain == "daily" else (day - timedelta(days=day.weekday())).isoformat() if grain == "weekly" else day.strftime("%Y-%m")
        row = series.get(day.isoformat(), {})
        value = row.get(metric, 0)
        if metric in {"unique_viewers", "accounts_reached"}:
            value = unique_daily.get(day.isoformat(), 0) if grain == "daily" else 0
        elif metric == "engagement_rate":
            value = 0
        buckets[key] = buckets.get(key, 0) + value
        bucket_days.setdefault(key, []).append(day)
    if metric in {"unique_viewers", "accounts_reached"} and grain != "daily":
        buckets = {key: analytics.reach(db, current.id, values[0], values[-1]) for key, values in bucket_days.items()}
    elif metric == "engagement_rate":
        buckets = {key: round(100 * sum(series.get(day.isoformat(), {}).get(name, 0) for day in values for name in ("likes", "comments", "shares", "saves")) /
                              max(1, sum(series.get(day.isoformat(), {}).get("views", 0) for day in values)), 2)
                   for key, values in bucket_days.items()}
    current_value = analytics.period_metrics(db, current.id, first, last).get(metric)
    previous_value = analytics.period_metrics(db, current.id, prior_first, prior_last).get(metric)
    return {"metric": metric, "grain": grain, "start": first.isoformat(), "end": last.isoformat(),
            "value": current_value, "previous": previous_value,
            "change_percent": compare(current_value, previous_value),
            "points": [{"date": key, "value": round(value, 2)} for key, value in sorted(buckets.items())],
            "views_by_type": analytics.view_types(db, current.id, first, last),
            "audience": analytics.audience_split(db, current.id, first, last),
            "definitions": {"views": "Qualified authenticated content views. Reels require at least 3 seconds; post views require half the card visible for one second.",
                            "accounts_reached": "Distinct signed-in accounts with a recorded content view.",
                            "engagement_rate": "Likes, comments, shares and saves divided by qualified views; can exceed 100%."}}


@router.get("/content")
def content(kind: Literal["all", "posts", "reels", "stories", "collaborative"] = "all",
            sort: Literal["latest", "views", "likes", "comments", "shares", "saves", "engagement"] = "latest",
            start: date | None = None, end: date | None = None, days: int = Query(30, ge=1, le=365),
            limit: int = Query(20, ge=1, le=50), offset: int = Query(0, ge=0),
            current: User = Depends(require_creator), db: Session = Depends(get_db)):
    first, last = period(days, start, end)
    total, keys = analytics.ranked_content(db, current.id, kind, sort, first, last, limit, offset)
    models = {"POST": Post, "REEL": Reel, "STORY": Story}
    items = [analytics.item_insights(db, current.id, item_kind, db.get(models[item_kind], item_id), first, last)
             for item_kind, item_id in keys]
    return {"items": items, "total": total,
            "next_offset": offset + len(items) if offset + len(items) < total else None}


@router.get("/insights/{kind}/{item_id}")
def insights(kind: Literal["POST", "REEL", "STORY"], item_id: int,
             start: date | None = None, end: date | None = None,
             days: int = Query(30, ge=1, le=365), current: User = Depends(get_current_user),
             db: Session = Depends(get_db)):
    first, last = period(days, start, end)
    model = {"POST": Post, "REEL": Reel, "STORY": Story}[kind]
    item = db.get(model, item_id)
    owner_id = (item.author_id if kind == "POST" else item.creator_id if kind == "REEL" else item.user_id) if item else None
    collaborator = kind == "POST" and item and db.query(PostCollaborator.id).filter_by(
        post_id=item_id, user_id=current.id, status="ACCEPTED").first()
    if not item or (kind in {"POST", "REEL"} and item.deleted_at) or (owner_id != current.id and not collaborator):
        raise HTTPException(404, "Content not found")
    if current.is_private and not collaborator:
        raise HTTPException(403, "A public account is required for insights")
    result = analytics.item_insights(db, current.id, kind, item, first, last)
    return {**result, "start": first.isoformat(), "end": last.isoformat(),
            "trend": analytics.item_trends(db, kind, item_id, first, last),
            "note": "Only recorded activity is shown. Historical post views before tracking began are unavailable."}


@router.get("/insights/{kind}/{item_id}/detail")
def detailed_insights(kind: Literal["POST", "REEL"], item_id: int,
                      window: Literal["FIRST_24H", "7D", "30D", "90D", "LIFETIME"] = "30D",
                      current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    from app.services.content_insights_detail import build
    item = db.get(Post if kind == "POST" else Reel, item_id)
    owner_id = item.author_id if kind == "POST" and item else item.creator_id if item else None
    collaborator = kind == "POST" and item and db.query(PostCollaborator.id).filter_by(
        post_id=item_id, user_id=current.id, status="ACCEPTED").first()
    if not item or item.deleted_at or (kind == "REEL" and item.status not in {"PUBLISHED", "ARCHIVED"}) or (owner_id != current.id and not collaborator):
        raise HTTPException(404, "Content not found")
    if current.is_private and not collaborator:
        raise HTTPException(403, "A public account is required for insights")
    report = build(db, kind, item, window)
    if kind == "REEL":
        from app.services.reel_service import signed_url
        report.update({"preview": item.caption or "Reel", "media_url": signed_url(item, current.id, "thumbnail"),
                       "media_type": "IMAGE", "url": f"/reels?id={item.public_id}"})
    else:
        report.update({"preview": item.content or "Media post", "media_url": item.media_url,
                       "media_type": item.media_type, "url": f"/posts/{item.public_id}"})
    return report


@router.get("/audience")
def audience(start: date | None = None, end: date | None = None,
             grain: Literal["daily", "weekly", "monthly"] = "daily",
             days: int = Query(30, ge=1, le=365), current: User = Depends(require_creator),
             db: Session = Depends(get_db)):
    first, last = period(days, start, end)
    series = analytics.daily(db, current.id, first, last)
    values = analytics.period_metrics(db, current.id, first, last)
    followers = db.query(func.count(Follow.id)).filter(Follow.following_id == current.id).scalar() or 0
    buckets = {}
    for i in range((last - first).days + 1):
        day = first + timedelta(days=i)
        key = day.isoformat() if grain == "daily" else (day - timedelta(days=day.weekday())).isoformat() if grain == "weekly" else day.strftime("%Y-%m")
        entry = buckets.setdefault(key, {"date": key, "gained": 0, "lost": 0})
        entry["gained"] += series.get(day.isoformat(), {}).get("followers_gained", 0)
        entry["lost"] += series.get(day.isoformat(), {}).get("followers_lost", 0)
    points = [buckets[key] for key in sorted(buckets)]
    return {"followers": followers, "gained": values["followers_gained"],
            "lost": values["followers_lost"], "net": values["followers_gained"] - values["followers_lost"],
            "growth_percent": compare(followers, followers - values["followers_gained"] + values["followers_lost"])
            if current.creator_enabled_at and current.creator_enabled_at.date() <= first else None,
            "grain": grain, "points": points, "demographics": None,
            "tracking_note": "Follow and unfollow history starts when this account first enables Creator mode. Older changes are unavailable.",
            "demographics_note": "Age and gender are not collected by Relaydot; demographic charts are unavailable.",
            "activity_note": "Follower active hours are unavailable because Relaydot does not track reliable, consented activity hours."}


@router.get("/recap")
def recap(month: str = Query(..., pattern=r"^\d{4}-(0[1-9]|1[0-2])$"),
          current: User = Depends(require_creator), db: Session = Depends(get_db)):
    first = date.fromisoformat(month + "-01")
    today = datetime.now(timezone.utc).date()
    if first > today:
        raise HTTPException(400, "Choose a completed or current month")
    next_month = (first.replace(day=28) + timedelta(days=4)).replace(day=1)
    last = min(next_month - timedelta(days=1), today)
    previous_last = first - timedelta(days=1)
    previous_first = previous_last.replace(day=1)
    current_values = analytics.period_metrics(db, current.id, first, last)
    prior_values = analytics.period_metrics(db, current.id, previous_first, previous_last)
    items = content(kind="all", sort="views", start=first, end=last, days=30,
                    limit=1, offset=0, current=current, db=db)["items"]
    return {"month": month, "start": first.isoformat(), "end": last.isoformat(),
            "views": current_values["views"], "views_previous": prior_values["views"],
            "followers_gained": current_values["followers_gained"],
            "followers_lost": current_values["followers_lost"],
            "engagements": sum(current_values[k] for k in ("likes", "comments", "shares", "saves")),
            "top_content": items[0] if items else None,
            "insufficient_data": not current_values["views"] and not items}


@router.get("/status")
def account_status(current: User = Depends(require_creator), db: Session = Depends(get_db)):
    actions = db.query(ModerationAction).filter_by(target_user_id=current.id).order_by(
        ModerationAction.created_at.desc()).limit(20).all()
    return {"account_state": current.account_state,
            "actions": [{"id": action.id, "action": action.action, "reason": action.reason,
                         "created_at": action.created_at.isoformat(),
                         "expires_at": action.expires_at.isoformat() if action.expires_at else None}
                        for action in actions],
            "appeal_url": "/support/appeals"}


@router.post("/scheduled-posts", status_code=201)
def create_schedule(data: ScheduleCreate, current: User = Depends(require_creator), db: Session = Depends(get_db)):
    throttle(current.id, "creator_schedule", 30, 3600)
    validate_scheduled_post(db, current, data.post)
    when = schedule_time(data.scheduled_at)
    payload = data.post.model_dump(mode="json", exclude={"client_id"})
    client_id = str(uuid.uuid4())
    row = ScheduledPost(owner_id=current.id, client_id=client_id, payload=payload,
                        scheduled_at=when, next_attempt_at=when, status="SCHEDULED")
    db.add(row); db.commit(); db.refresh(row)
    return schedule_dict(row)


@router.get("/scheduled-posts")
def schedules(limit: int = Query(20, ge=1, le=50), offset: int = Query(0, ge=0),
              current: User = Depends(require_creator), db: Session = Depends(get_db)):
    query = db.query(ScheduledPost).filter_by(owner_id=current.id).order_by(ScheduledPost.scheduled_at.desc())
    rows = query.offset(offset).limit(limit).all()
    total = query.count()
    return {"items": [schedule_dict(row) for row in rows], "total": total,
            "next_offset": offset + len(rows) if offset + len(rows) < total else None}


@router.patch("/scheduled-posts/{scheduled_id}")
def edit_schedule(scheduled_id: int, data: ScheduleUpdate,
                  current: User = Depends(require_creator), db: Session = Depends(get_db)):
    row = db.query(ScheduledPost).filter_by(id=scheduled_id, owner_id=current.id).first()
    if not row:
        raise HTTPException(404, "Scheduled post not found")
    if row.status not in {"SCHEDULED", "FAILED", "PAUSED"}:
        raise HTTPException(409, "This post is already publishing or published")
    if data.post:
        validate_scheduled_post(db, current, data.post)
        row.payload = data.post.model_dump(mode="json", exclude={"client_id"})
    if data.scheduled_at:
        row.scheduled_at = schedule_time(data.scheduled_at)
    row.next_attempt_at = row.scheduled_at
    row.status = "SCHEDULED"
    row.attempts = 0
    row.error = None
    db.commit()
    return schedule_dict(row)


@router.delete("/scheduled-posts/{scheduled_id}")
def cancel_schedule(scheduled_id: int, current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.query(ScheduledPost).filter_by(id=scheduled_id, owner_id=current.id).first()
    if not row:
        raise HTTPException(404, "Scheduled post not found")
    if row.status not in {"SCHEDULED", "FAILED", "PAUSED"}:
        raise HTTPException(409, "This post is already publishing or published")
    row.status = "CANCELLED"
    db.commit()
    return {"status": "CANCELLED"}
