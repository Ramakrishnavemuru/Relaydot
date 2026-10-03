"""Visibility, serialization and deterministic feed ranking for social posts."""
from datetime import datetime, timedelta, timezone
from math import log1p
from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session, joinedload
from app.models.user import User
from app.models.block import BlockedUser
from app.models.social import (Bookmark, Comment, CommunityMember, Follow, PollOption,
    PollVote, Post, PostReaction)


class FeedService:
    @staticmethod
    def iso(dt):
        return dt.replace(tzinfo=timezone.utc).isoformat() if dt.tzinfo is None else dt.isoformat()

    @staticmethod
    def blocked_ids(db: Session, viewer_id: int) -> set[int]:
        rows = db.query(BlockedUser).filter(or_(BlockedUser.blocker_id == viewer_id,
            BlockedUser.blocked_id == viewer_id)).all()
        return {r.blocked_id if r.blocker_id == viewer_id else r.blocker_id for r in rows}

    @staticmethod
    def following_ids(db: Session, viewer_id: int) -> set[int]:
        return {row[0] for row in db.query(Follow.following_id).filter(Follow.follower_id == viewer_id)}

    @staticmethod
    def visible_query(db: Session, viewer_id: int):
        following = FeedService.following_ids(db, viewer_id)
        mutual = {row[0] for row in db.query(Follow.follower_id).filter(
            Follow.following_id == viewer_id, Follow.follower_id.in_(following))} if following else set()
        allowed = or_(Post.visibility == "EVERYONE", Post.author_id == viewer_id,
            and_(Post.visibility == "FOLLOWERS", Post.author_id.in_(following or [-1])),
            and_(Post.visibility == "FRIENDS", Post.author_id.in_(mutual or [-1])))
        return db.query(Post).options(joinedload(Post.author), joinedload(Post.community)).filter(
            Post.deleted_at.is_(None), allowed,
            ~Post.author_id.in_(FeedService.blocked_ids(db, viewer_id) or [-1]))

    @staticmethod
    def can_view(db: Session, post: Post, viewer_id: int) -> bool:
        return FeedService.visible_query(db, viewer_id).filter(Post.id == post.id).first() is not None

    @staticmethod
    def score(post: Post, following: set[int], likes: int, comments: int, now: datetime) -> float:
        created = post.created_at.replace(tzinfo=timezone.utc) if post.created_at.tzinfo is None else post.created_at
        age_hours = max(0, (now - created).total_seconds() / 3600)
        return 100 / (1 + age_hours / 12) + (18 if post.author_id in following else 0) + 3 * log1p(likes + comments * 2)

    @staticmethod
    def feed(db: Session, viewer_id: int, mode: str, limit: int, offset: int):
        q = FeedService.visible_query(db, viewer_id)
        if mode == "following":
            ids = FeedService.following_ids(db, viewer_id) | {viewer_id}
            return q.filter(Post.author_id.in_(ids)).order_by(Post.created_at.desc(), Post.id.desc()).offset(offset).limit(limit).all()
        # A bounded recent candidate set keeps old viral posts from dominating and makes ranking stable.
        now = datetime.now(timezone.utc)
        candidates = q.filter(Post.created_at >= now - timedelta(days=14)).order_by(
            Post.created_at.desc(), Post.id.desc()).limit(500).all()
        ids = [p.id for p in candidates]
        counts = {p: (likes, comments) for p, likes, comments in db.query(
            Post.id, func.count(func.distinct(PostReaction.id)), func.count(func.distinct(Comment.id)))
            .outerjoin(PostReaction, PostReaction.post_id == Post.id)
            .outerjoin(Comment, and_(Comment.post_id == Post.id, Comment.deleted_at.is_(None)))
            .filter(Post.id.in_(ids or [-1])).group_by(Post.id)}
        following = FeedService.following_ids(db, viewer_id)
        candidates.sort(key=lambda p: (-FeedService.score(p, following, *counts.get(p.id, (0, 0)), now), -p.id))
        return candidates[offset:offset + limit]

    @staticmethod
    def serialize_many(db: Session, posts: list[Post], viewer_id: int) -> list[dict]:
        ids = [p.id for p in posts]
        if not ids:
            return []
        grouped = lambda model, where=None: dict(db.query(model.post_id, func.count(model.id)).filter(
            model.post_id.in_(ids), *(where or [])).group_by(model.post_id).all())
        likes = grouped(PostReaction)
        comments = grouped(Comment, [Comment.deleted_at.is_(None)])
        reposts = dict(db.query(Post.repost_of_id, func.count(Post.id)).filter(
            Post.repost_of_id.in_(ids), Post.deleted_at.is_(None)).group_by(Post.repost_of_id).all())
        reactions = {r.post_id:r.emoji for r in db.query(PostReaction).filter(
            PostReaction.post_id.in_(ids), PostReaction.user_id == viewer_id)}
        bookmarks = {r.post_id for r in db.query(Bookmark).filter(
            Bookmark.post_id.in_(ids), Bookmark.user_id == viewer_id)}
        options = {}
        for option in db.query(PollOption).filter(PollOption.post_id.in_(ids)).order_by(PollOption.position):
            options.setdefault(option.post_id, []).append(option)
        votes = {r.post_id:r.option_id for r in db.query(PollVote).filter(
            PollVote.post_id.in_(ids), PollVote.user_id == viewer_id)}
        vote_counts = dict(db.query(PollVote.option_id, func.count(PollVote.id)).filter(
            PollVote.post_id.in_(ids)).group_by(PollVote.option_id).all())
        stats = {pid:{"likes":likes.get(pid,0), "comments":comments.get(pid,0),
            "reposts":reposts.get(pid,0), "reaction":reactions.get(pid),
            "bookmarked":pid in bookmarks, "options":options.get(pid,[]),
            "vote":votes.get(pid), "vote_counts":vote_counts} for pid in ids}
        return [FeedService.serialize(db, p, viewer_id, stats=stats) for p in posts]

    @staticmethod
    def serialize(db: Session, post: Post, viewer_id: int, nested=False, stats=None) -> dict:
        author = post.author or db.get(User, post.author_id)
        s = stats.get(post.id) if stats else None
        likes = s["likes"] if s else db.query(func.count(PostReaction.id)).filter(PostReaction.post_id == post.id).scalar() or 0
        comments = s["comments"] if s else db.query(func.count(Comment.id)).filter(Comment.post_id == post.id, Comment.deleted_at.is_(None)).scalar() or 0
        reposts = s["reposts"] if s else db.query(func.count(Post.id)).filter(Post.repost_of_id == post.id, Post.deleted_at.is_(None)).scalar() or 0
        reaction = s["reaction"] if s else db.query(PostReaction).filter(PostReaction.post_id == post.id, PostReaction.user_id == viewer_id).first()
        bookmarked = s["bookmarked"] if s else db.query(Bookmark.id).filter(Bookmark.post_id == post.id, Bookmark.user_id == viewer_id).first() is not None
        options = s["options"] if s else db.query(PollOption).filter(PollOption.post_id == post.id).order_by(PollOption.position).all()
        vote = s["vote"] if s else db.query(PollVote).filter(PollVote.post_id == post.id, PollVote.user_id == viewer_id).first()
        vote_counts = s["vote_counts"] if s else dict(db.query(PollVote.option_id, func.count(PollVote.id)).filter(
            PollVote.post_id == post.id).group_by(PollVote.option_id).all()) if options else {}
        related = None
        if not nested and (post.repost_of_id or post.quote_of_id):
            original = db.get(Post, post.repost_of_id or post.quote_of_id)
            if original and FeedService.can_view(db, original, viewer_id):
                related = FeedService.serialize(db, original, viewer_id, nested=True)
        show_results = bool(vote) or post.author_id == viewer_id
        return {
            "id": post.id, "author": author.to_dict(False), "author_id": post.author_id,
            "content": post.content, "media_url": post.media_url, "media_type": post.media_type,
            "visibility": post.visibility, "reply_policy": post.reply_policy,
            "community_id": post.community_id, "community_name": post.community.name if post.community else None,
            "created_at": FeedService.iso(post.created_at), "edited_at": FeedService.iso(post.edited_at) if post.edited_at else None,
            "repost_of_id": post.repost_of_id, "quote_of_id": post.quote_of_id,
            "thread_parent_id": post.thread_parent_id, "pinned": post.pinned,
            "original": related, "likes_count": likes, "comments_count": comments,
            "reposts_count": reposts, "my_reaction": (reaction if s else reaction.emoji) if reaction else None,
            "bookmarked": bookmarked, "poll": [{"id": o.id, "label": o.label,
                "votes": vote_counts.get(o.id, 0) if show_results else None} for o in options],
            "my_vote": (vote if s else vote.option_id) if vote else None,
            "poll_total": sum(vote_counts.values()) if show_results else None
        }
