"""Per-item reports from retained interactions and measured playback sessions."""
from datetime import datetime, timedelta, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.creator import CreatorEvent
from app.models.reel import ReelBookmark, ReelComment, ReelLike, ReelPlayback, ReelShare, ReelView
from app.models.social import Bookmark, Comment, Post, PostReaction

AUDIENCE_MIN = 10


def window_for(item, kind: str, selection: str):
    now = datetime.now(timezone.utc)
    published = item.created_at if kind == "POST" else item.published_at or item.created_at
    published = published.replace(tzinfo=timezone.utc) if published.tzinfo is None else published
    if selection == "FIRST_24H":
        return published, min(now, published + timedelta(hours=24))
    if selection == "LIFETIME":
        return published, now
    return max(published, now - timedelta(days={"7D": 7, "30D": 30, "90D": 90}[selection])), now


def build(db: Session, kind: str, item, selection: str) -> dict:
    start, end = window_for(item, kind, selection)
    if kind == "POST":
        view_model, actor, stamp = CreatorEvent, CreatorEvent.actor_id, CreatorEvent.created_at
        view_filter = (CreatorEvent.event_type == "POST_VIEW", CreatorEvent.content_type == "POST",
                       CreatorEvent.content_id == item.id)
        owner_id = item.author_id
        likes_model, likes_fk, likes_stamp = PostReaction, PostReaction.post_id, PostReaction.created_at
        comments_model, comments_fk, comments_stamp = Comment, Comment.post_id, Comment.created_at
        saves_model, saves_fk, saves_stamp = Bookmark, Bookmark.post_id, Bookmark.created_at
        shares_model, shares_fk, shares_stamp = CreatorEvent, CreatorEvent.content_id, CreatorEvent.created_at
        shares_extra = (CreatorEvent.event_type == "POST_SHARE", CreatorEvent.content_type == "POST")
        reposts = db.query(func.count(Post.id)).filter(Post.repost_of_id == item.id,
            Post.deleted_at.is_(None), Post.created_at >= start, Post.created_at < end).scalar() or 0
    else:
        view_model, actor, stamp = ReelView, ReelView.user_id, ReelView.created_at
        view_filter = (ReelView.reel_id == item.id, ReelView.user_id != item.creator_id)
        owner_id = item.creator_id
        likes_model, likes_fk, likes_stamp = ReelLike, ReelLike.reel_id, ReelLike.created_at
        comments_model, comments_fk, comments_stamp = ReelComment, ReelComment.reel_id, ReelComment.created_at
        saves_model, saves_fk, saves_stamp = ReelBookmark, ReelBookmark.reel_id, ReelBookmark.created_at
        shares_model, shares_fk, shares_stamp = ReelShare, ReelShare.reel_id, ReelShare.created_at
        shares_extra = ()
        reposts = None  # Reel reposts are not a Relaydot feature.
    view_scope = (*view_filter, stamp >= start, stamp < end)
    views = db.query(func.count(view_model.id)).filter(*view_scope).scalar() or 0
    reached = db.query(func.count(func.distinct(actor))).filter(*view_scope).scalar() or 0
    first_view_ids = db.query(func.min(view_model.id)).filter(*view_scope).group_by(actor)
    audience_rows = db.query(view_model.audience_kind, func.count(view_model.id)).filter(
        view_model.id.in_(first_view_ids)).group_by(view_model.audience_kind).all()
    audience_raw = dict(audience_rows)
    audience = {"followers": audience_raw.get("FOLLOWER", 0),
                "non_followers": audience_raw.get("NON_FOLLOWER", 0),
                "unknown": sum(count for name, count in audience_rows if name not in {"FOLLOWER", "NON_FOLLOWER"})}
    def count(model, fk, timestamp, *extra):
        return db.query(func.count(model.id)).filter(fk == item.id,
            timestamp >= start, timestamp < end, *extra).scalar() or 0
    likes = count(likes_model, likes_fk, likes_stamp)
    comments = count(comments_model, comments_fk, comments_stamp, comments_model.deleted_at.is_(None))
    saves = count(saves_model, saves_fk, saves_stamp)
    shares = count(shares_model, shares_fk, shares_stamp, *shares_extra)
    follows = db.query(func.count(CreatorEvent.id)).filter(
        CreatorEvent.owner_id == owner_id, CreatorEvent.event_type == "FOLLOW_ATTRIBUTED",
        CreatorEvent.content_type == kind, CreatorEvent.content_id == item.id,
        CreatorEvent.created_at >= start, CreatorEvent.created_at < end).scalar() or 0
    interactions = likes + comments + shares + saves + (reposts or 0)
    rate = lambda value: round(100 * value / views, 2) if views else None
    metrics = {"views": views, "reach": reached, "likes": likes, "comments": comments,
               "shares": shares, "reposts": reposts, "saves": saves, "follows": follows,
               "profile_visits": None, "interactions": interactions,
               "engagement_rate": rate(interactions)}
    rates = {name: {"value": rate(value), "formula": f"{label} / qualified views × 100"}
             for name, value, label in (("like", likes, "Current likes"),
                 ("comment", comments, "Current comments"),
                 ("share", shares, "Delivered chat shares"),
                 ("save", saves, "Current saves"))}
    rates["repost"] = {"value": rate(reposts), "formula": "Current reposts / qualified views × 100"} if reposts is not None else None
    watch = None
    if kind == "REEL":
        rows = db.query(ReelPlayback).filter(ReelPlayback.reel_id == item.id,
            ReelPlayback.user_id != owner_id, ReelPlayback.started_at >= start,
            ReelPlayback.started_at < end)
        starts = rows.count()
        watched = db.query(func.sum(ReelPlayback.watched_ms)).filter(ReelPlayback.reel_id == item.id,
            ReelPlayback.user_id != owner_id, ReelPlayback.started_at >= start,
            ReelPlayback.started_at < end).scalar() or 0
        skips = rows.filter(ReelPlayback.skipped.is_(True)).count()
        completed = rows.filter(ReelPlayback.completed.is_(True)).count()
        replays = db.query(func.sum(ReelPlayback.replay_count)).filter(ReelPlayback.reel_id == item.id,
            ReelPlayback.user_id != owner_id, ReelPlayback.started_at >= start,
            ReelPlayback.started_at < end).scalar() or 0
        watch = {"starts": starts, "total_watch_ms": watched,
                 "average_watch_ms": round(watched / starts) if starts else None,
                 "skips": skips, "completed": completed, "replays": replays}
        rates["skip"] = {"value": round(100 * skips / starts, 2) if starts else None,
                         "formula": "Early exits / recorded playback starts × 100"}
        rates["completion"] = {"value": round(100 * completed / starts, 2) if starts else None,
                               "formula": "Completed sessions / recorded playback starts × 100"}
    trend = {}
    for label, model, fk, timestamp, extra in (
        ("views", view_model, view_model.content_id if kind == "POST" else view_model.reel_id, stamp, view_filter),
        ("likes", likes_model, likes_fk, likes_stamp, ()),
        ("comments", comments_model, comments_fk, comments_stamp, (comments_model.deleted_at.is_(None),)),
        ("shares", shares_model, shares_fk, shares_stamp, shares_extra),
        ("saves", saves_model, saves_fk, saves_stamp, ())):
        rows = db.query(func.date(timestamp), func.count(model.id)).filter(
            fk == item.id, timestamp >= start, timestamp < end, *extra).group_by(func.date(timestamp))
        for day, value in rows:
            trend.setdefault(str(day)[:10], {"date": str(day)[:10], "views": 0, "engagements": 0})[
                "views" if label == "views" else "engagements"] += value
    if kind == "POST":
        rows = db.query(func.date(Post.created_at), func.count(Post.id)).filter(
            Post.repost_of_id == item.id, Post.deleted_at.is_(None),
            Post.created_at >= start, Post.created_at < end).group_by(func.date(Post.created_at))
        for day, value in rows:
            trend.setdefault(str(day)[:10], {"date": str(day)[:10], "views": 0, "engagements": 0})["engagements"] += value
    return {"kind": kind, "id": item.id, "selection": selection,
            "start": start.isoformat(), "end": end.isoformat(), "metrics": metrics,
            "rates": rates, "watch": watch, "trend": [trend[key] for key in sorted(trend)],
            "audience": audience if reached >= AUDIENCE_MIN else None,
            "audience_min": AUDIENCE_MIN,
            "published_at": (item.created_at if kind == "POST" else item.published_at or item.created_at).isoformat(),
            "note": "Current likes, comments, saves and reposts are counted by creation time; removed interactions are unavailable. Watch time is available only for playback sessions recorded after tracking began."}
