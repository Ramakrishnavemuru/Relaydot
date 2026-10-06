"""Reel visibility, ranking, signed media access, and shared social indexing."""
import hashlib
import hmac
import re
import time
from datetime import datetime, timezone
from math import log1p
from urllib.parse import quote
from fastapi import HTTPException
from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session
from app.config import settings
from app.models.user import User
from app.models.social import Follow, Hashtag
from app.models.reel import (Reel, ReelLike, ReelBookmark, ReelComment, ReelView,
    ReelShare, ReelHashtag, ReelMention)
from app.services.feed_service import FeedService
from app.services.user_service import UserService

TAG = re.compile(r"(?<!\w)#([A-Za-z0-9_]{1,50})\b")
MENTION = re.compile(r"(?<!\w)@([A-Za-z0-9_]{3,30})\b")


def visible_query(db: Session, viewer_id: int):
    followed = FeedService.following_ids(db, viewer_id)
    mutual = {row[0] for row in db.query(Follow.follower_id).filter(
        Follow.following_id == viewer_id, Follow.follower_id.in_(followed))} if followed else set()
    return db.query(Reel).filter(Reel.status == "PUBLISHED", Reel.deleted_at.is_(None),
        or_(Reel.visibility == "EVERYONE", Reel.creator_id == viewer_id,
            and_(Reel.visibility == "FOLLOWERS", Reel.creator_id.in_(followed or [-1])),
            and_(Reel.visibility == "FRIENDS", Reel.creator_id.in_(mutual or [-1]))),
        ~Reel.creator_id.in_(FeedService.blocked_ids(db, viewer_id) or [-1]))


def get_visible(db: Session, public_id: str, viewer_id: int) -> Reel:
    reel = visible_query(db, viewer_id).filter(Reel.public_id == public_id).first()
    if not reel:
        own = db.query(Reel).filter_by(public_id=public_id, creator_id=viewer_id).first()
        if own and own.status not in {"REMOVED", "PUBLISHED"} and not own.deleted_at:
            return own
        raise HTTPException(404, "Reel not found")
    return reel


def signed_url(reel: Reel, viewer_id: int, kind: str) -> str | None:
    if not (reel.video_path if kind == "video" else reel.thumbnail_path):
        return None
    expires = int(time.time()) + 3600
    message = f"{reel.public_id}:{viewer_id}:{kind}:{expires}".encode()
    signature = hmac.new(settings.SECRET_KEY.encode(), message, hashlib.sha256).hexdigest()
    version = int(reel.updated_at.replace(tzinfo=timezone.utc).timestamp()) if reel.updated_at else 0
    return f"/api/reels/{quote(reel.public_id)}/media/{kind}?viewer={viewer_id}&expires={expires}&signature={signature}&v={version}"


def valid_signature(public_id: str, viewer_id: int, kind: str, expires: int, signature: str) -> bool:
    if not int(time.time()) < expires <= int(time.time()) + 3600:
        return False
    message = f"{public_id}:{viewer_id}:{kind}:{expires}".encode()
    expected = hmac.new(settings.SECRET_KEY.encode(), message, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


def serialize(db: Session, reel: Reel, viewer_id: int) -> dict:
    creator = db.get(User, reel.creator_id)
    count = lambda model: db.query(func.count(model.id)).filter(model.reel_id == reel.id).scalar() or 0
    return {"id":reel.id,"public_id":reel.public_id,"creator":creator.to_dict(False),
        "creator_id":reel.creator_id,"caption":reel.caption,"visibility":reel.visibility,
        "status":reel.status,"error":reel.error if reel.creator_id == viewer_id else None,
        "duration":reel.duration,"width":reel.width,"height":reel.height,
        "allow_comments":reel.allow_comments,"allow_download":reel.allow_download,
        "video_url":signed_url(reel, viewer_id, "video"),
        "thumbnail_url":signed_url(reel, viewer_id, "thumbnail"),
        "created_at":FeedService.iso(reel.created_at),
        "published_at":FeedService.iso(reel.published_at) if reel.published_at else None,
        "likes_count":count(ReelLike),"comments_count":db.query(func.count(ReelComment.id)).filter(
            ReelComment.reel_id == reel.id, ReelComment.deleted_at.is_(None)).scalar() or 0,
        "views_count":count(ReelView),"shares_count":count(ReelShare),
        "liked":db.query(ReelLike.id).filter_by(reel_id=reel.id,user_id=viewer_id).first() is not None,
        "bookmarked":db.query(ReelBookmark.id).filter_by(reel_id=reel.id,user_id=viewer_id).first() is not None,
        "following":db.query(Follow.id).filter_by(follower_id=viewer_id,following_id=reel.creator_id).first() is not None,
        "hashtags":[name for (name,) in db.query(Hashtag.name).join(ReelHashtag,
            ReelHashtag.hashtag_id == Hashtag.id).filter(ReelHashtag.reel_id == reel.id)]}


def index_caption(db: Session, reel: Reel) -> list[int]:
    previous = {row[0] for row in db.query(ReelMention.user_id).filter_by(reel_id=reel.id)}
    db.query(ReelHashtag).filter_by(reel_id=reel.id).delete()
    db.query(ReelMention).filter_by(reel_id=reel.id).delete()
    for name in {name.lower() for name in TAG.findall(reel.caption)}:
        tag = db.query(Hashtag).filter_by(name=name).first()
        if not tag:
            tag = Hashtag(name=name)
            db.add(tag)
            db.flush()
        db.add(ReelHashtag(reel_id=reel.id, hashtag_id=tag.id))
    mentioned = []
    for name in {name.lower() for name in MENTION.findall(reel.caption)}:
        user = db.query(User).filter(func.lower(User.username) == name).first()
        if user and user.id != reel.creator_id and not UserService.is_blocked(db, reel.creator_id, user.id):
            db.add(ReelMention(reel_id=reel.id, user_id=user.id))
            mentioned.append(user.id)
    db.commit()
    return [user_id for user_id in mentioned if user_id not in previous]


def feed(db: Session, viewer_id: int, mode: str, limit: int, offset: int, q: str = "") -> list[Reel]:
    query = visible_query(db, viewer_id)
    if mode in {"for_you", "trending"}:
        query = query.filter(Reel.visibility == "EVERYONE")
    if mode == "following":
        query = query.filter(Reel.creator_id.in_(FeedService.following_ids(db, viewer_id) | {viewer_id}))
    if q:
        escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        query = query.join(User, User.id == Reel.creator_id).outerjoin(
            ReelHashtag, ReelHashtag.reel_id == Reel.id).outerjoin(
            Hashtag, Hashtag.id == ReelHashtag.hashtag_id).filter(or_(
                Reel.caption.ilike(f"%{escaped}%", escape="\\"),
                User.username.ilike(f"%{escaped}%", escape="\\"),
                Hashtag.name.ilike(f"%{escaped.lstrip('#')}%", escape="\\"))).distinct()
    if mode == "new" or mode == "following" or q:
        return query.order_by(Reel.published_at.desc(), Reel.id.desc()).offset(offset).limit(limit).all()
    candidates = query.order_by(Reel.published_at.desc()).limit(300).all()
    now = datetime.now(timezone.utc)
    ids = [r.id for r in candidates]
    likes = dict(db.query(ReelLike.reel_id, func.count(ReelLike.id)).filter(
        ReelLike.reel_id.in_(ids or [-1])).group_by(ReelLike.reel_id))
    views = dict(db.query(ReelView.reel_id, func.count(ReelView.id)).filter(
        ReelView.reel_id.in_(ids or [-1])).group_by(ReelView.reel_id))
    follows = FeedService.following_ids(db, viewer_id)
    def score(reel):
        age = max(0, (now - reel.published_at.replace(tzinfo=timezone.utc)).total_seconds()/3600)
        trend = 8*log1p(likes.get(reel.id,0)) + 2*log1p(views.get(reel.id,0))
        return trend / (1+age/24) if mode == "trending" else 30/(1+age/24) + trend + (15 if reel.creator_id in follows else 0)
    candidates.sort(key=lambda r:(-score(r),-r.id))
    return candidates[offset:offset+limit]
