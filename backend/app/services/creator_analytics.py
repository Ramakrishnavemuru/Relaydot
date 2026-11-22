"""Creator metrics sourced from recorded Relaydot activity, never estimates."""
from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import and_, func, literal, or_, select, union_all
from sqlalchemy.orm import Session

from app.models.creator import CreatorEvent
from app.models.reel import Reel, ReelBookmark, ReelComment, ReelLike, ReelShare, ReelView
from app.models.social import Bookmark, Comment, Follow, Post, PostCollaborator, PostReaction
from app.models.story import Story
from app.models.story_view import StoryView

METRICS = {"views", "unique_viewers", "accounts_reached", "profile_visits", "likes",
           "comments", "shares", "saves", "engagement_rate", "followers_gained", "followers_lost"}


def bounds(start: date, end: date):
    return datetime.combine(start, time.min, timezone.utc), datetime.combine(end + timedelta(days=1), time.min, timezone.utc)


def accepted_post_ids(db: Session, user_id: int):
    return db.query(PostCollaborator.post_id).filter_by(user_id=user_id, status="ACCEPTED")


def post_scope(db: Session, user_id: int):
    return or_(Post.author_id == user_id, Post.id.in_(accepted_post_ids(db, user_id)))


def post_event_scope(db: Session, user_id: int):
    return or_(CreatorEvent.owner_id == user_id,
               and_(CreatorEvent.event_type.in_(("POST_VIEW", "POST_SHARE")),
                    CreatorEvent.content_type == "POST",
                    CreatorEvent.content_id.in_(accepted_post_ids(db, user_id))))


def _add_grouped(target: dict, rows, metric: str):
    for day, count in rows:
        target[str(day)[:10]][metric] += int(count or 0)


def daily(db: Session, user_id: int, start: date, end: date) -> dict[str, dict[str, int]]:
    """Aggregate indexed event and engagement tables once per metric and period."""
    result = defaultdict(lambda: defaultdict(int))
    first, until = bounds(start, end)
    event_q = db.query(func.date(CreatorEvent.created_at), CreatorEvent.event_type,
                       func.count(CreatorEvent.id)).filter(
        post_event_scope(db, user_id), CreatorEvent.day >= start, CreatorEvent.day <= end).group_by(
        func.date(CreatorEvent.created_at), CreatorEvent.event_type)
    event_map = {"POST_VIEW": "views", "POST_SHARE": "shares", "PROFILE_VISIT": "profile_visits",
                 "FOLLOW_GAIN": "followers_gained", "FOLLOW_LOSS": "followers_lost"}
    for day, event_type, count in event_q:
        if event_type in event_map:
            result[str(day)[:10]][event_map[event_type]] += count

    sources = (
        (ReelView, Reel, ReelView.reel_id, ReelView.created_at, "views", ReelView.user_id != Reel.creator_id, Reel.status == "PUBLISHED"),
        (StoryView, Story, StoryView.story_id, StoryView.viewed_at, "views", StoryView.viewer_id != Story.user_id, True),
        (PostReaction, Post, PostReaction.post_id, PostReaction.created_at, "likes", post_scope(db, user_id), True),
        (Comment, Post, Comment.post_id, Comment.created_at, "comments", and_(post_scope(db, user_id), Comment.deleted_at.is_(None)), True),
        (Bookmark, Post, Bookmark.post_id, Bookmark.created_at, "saves", post_scope(db, user_id), True),
        (ReelLike, Reel, ReelLike.reel_id, ReelLike.created_at, "likes", True, Reel.status == "PUBLISHED"),
        (ReelComment, Reel, ReelComment.reel_id, ReelComment.created_at, "comments", ReelComment.deleted_at.is_(None), Reel.status == "PUBLISHED"),
        (ReelBookmark, Reel, ReelBookmark.reel_id, ReelBookmark.created_at, "saves", True, Reel.status == "PUBLISHED"),
        (ReelShare, Reel, ReelShare.reel_id, ReelShare.created_at, "shares", True, Reel.status == "PUBLISHED"),
    )
    for model, content, fk, timestamp, metric, extra, status_filter in sources:
        owner_filter = post_scope(db, user_id) if content is Post else (content.creator_id == user_id if content is Reel else content.user_id == user_id)
        rows = db.query(func.date(timestamp), func.count(model.id)).join(content, content.id == fk).filter(
            owner_filter, content.deleted_at.is_(None) if content is not Story else True,
            timestamp >= first, timestamp < until, extra, status_filter).group_by(func.date(timestamp)).all()
        _add_grouped(result, rows, metric)
    return result


def reach(db: Session, user_id: int, start: date, end: date) -> int:
    first, until = bounds(start, end)
    post = select(CreatorEvent.actor_id.label("viewer")).where(
        CreatorEvent.event_type == "POST_VIEW", post_event_scope(db, user_id),
        CreatorEvent.day >= start, CreatorEvent.day <= end,
        CreatorEvent.actor_id.is_not(None))
    reels = select(ReelView.user_id.label("viewer")).join(Reel, Reel.id == ReelView.reel_id).where(
        Reel.creator_id == user_id, Reel.status == "PUBLISHED", Reel.deleted_at.is_(None),
        ReelView.created_at >= first, ReelView.created_at < until, ReelView.user_id != user_id)
    stories = select(StoryView.viewer_id.label("viewer")).join(Story, Story.id == StoryView.story_id).where(
        Story.user_id == user_id, StoryView.viewed_at >= first, StoryView.viewed_at < until,
        StoryView.viewer_id != user_id)
    viewers = union_all(post, reels, stories).subquery()
    return db.query(func.count(func.distinct(viewers.c.viewer))).scalar() or 0


def daily_reach(db: Session, user_id: int, start: date, end: date) -> dict[str, int]:
    first, until = bounds(start, end)
    post = select(CreatorEvent.day.label("day"), CreatorEvent.actor_id.label("viewer")).where(
        CreatorEvent.event_type == "POST_VIEW", post_event_scope(db, user_id),
        CreatorEvent.day >= start, CreatorEvent.day <= end,
        CreatorEvent.actor_id.is_not(None))
    reels = select(func.date(ReelView.created_at).label("day"), ReelView.user_id.label("viewer")).join(
        Reel, Reel.id == ReelView.reel_id).where(Reel.creator_id == user_id,
        Reel.status == "PUBLISHED", Reel.deleted_at.is_(None), ReelView.user_id != user_id,
        ReelView.created_at >= first, ReelView.created_at < until)
    stories = select(func.date(StoryView.viewed_at).label("day"), StoryView.viewer_id.label("viewer")).join(
        Story, Story.id == StoryView.story_id).where(Story.user_id == user_id,
        StoryView.viewer_id != user_id, StoryView.viewed_at >= first, StoryView.viewed_at < until)
    viewers = union_all(post, reels, stories).subquery()
    return {str(day)[:10]: count for day, count in db.query(viewers.c.day,
        func.count(func.distinct(viewers.c.viewer))).group_by(viewers.c.day)}


def audience_split(db: Session, user_id: int, start: date, end: date) -> dict:
    first, until = bounds(start, end)
    result = {"FOLLOWER": 0, "NON_FOLLOWER": 0, "UNKNOWN": 0}
    grouped = db.query(CreatorEvent.audience_kind, func.count(CreatorEvent.id)).filter(
        CreatorEvent.event_type == "POST_VIEW", post_event_scope(db, user_id),
        CreatorEvent.day >= start, CreatorEvent.day <= end).group_by(CreatorEvent.audience_kind)
    for kind, count in grouped:
        result[kind if kind in result else "UNKNOWN"] += count
    for model, content, fk, stamp in ((ReelView, Reel, ReelView.reel_id, ReelView.created_at),
                                       (StoryView, Story, StoryView.story_id, StoryView.viewed_at)):
        owner = content.creator_id if content is Reel else content.user_id
        actor = model.user_id if content is Reel else model.viewer_id
        for kind, count in db.query(model.audience_kind, func.count(model.id)).join(
            content, content.id == fk).filter(owner == user_id, actor != user_id,
            stamp >= first, stamp < until).group_by(model.audience_kind):
            result[kind if kind in result else "UNKNOWN"] += count
    return {"followers": result["FOLLOWER"], "non_followers": result["NON_FOLLOWER"],
            "unknown": result["UNKNOWN"]}


def view_types(db: Session, user_id: int, start: date, end: date) -> dict:
    first, until = bounds(start, end)
    kinds = {"reels": 0, "image_posts": 0, "text_posts": 0, "video_posts": 0, "stories": 0}
    for media_type, count in db.query(Post.media_type, func.count(CreatorEvent.id)).join(
        Post, Post.id == CreatorEvent.content_id).filter(
        CreatorEvent.event_type == "POST_VIEW", CreatorEvent.content_type == "POST",
        post_scope(db, user_id), Post.deleted_at.is_(None),
        CreatorEvent.day >= start, CreatorEvent.day <= end).group_by(Post.media_type):
        key = "image_posts" if media_type in {"IMAGE", "GIF"} else "video_posts" if media_type == "VIDEO" else "text_posts"
        kinds[key] += count
    kinds["reels"] = db.query(func.count(ReelView.id)).join(Reel).filter(
        Reel.creator_id == user_id, Reel.status == "PUBLISHED", Reel.deleted_at.is_(None),
        ReelView.user_id != user_id, ReelView.created_at >= first, ReelView.created_at < until).scalar() or 0
    kinds["stories"] = db.query(func.count(StoryView.id)).join(Story).filter(
        Story.user_id == user_id, StoryView.viewer_id != user_id,
        StoryView.viewed_at >= first, StoryView.viewed_at < until).scalar() or 0
    return kinds


def period_metrics(db: Session, user_id: int, start: date, end: date) -> dict:
    days = daily(db, user_id, start, end)
    totals = {metric: sum(day.get(metric, 0) for day in days.values()) for metric in METRICS}
    totals["unique_viewers"] = reach(db, user_id, start, end)
    totals["accounts_reached"] = totals["unique_viewers"]
    totals["engagement_rate"] = round(100 * sum(totals[key] for key in ("likes", "comments", "shares", "saves")) / totals["views"], 2) if totals["views"] else None
    return totals


def item_insights(db: Session, user_id: int, kind: str, item, start: date, end: date) -> dict:
    first, until = bounds(start, end)
    if kind == "POST":
        views = db.query(CreatorEvent).filter_by(event_type="POST_VIEW", content_type="POST", content_id=item.id).filter(
            CreatorEvent.day >= start, CreatorEvent.day <= end)
        view_count = views.count()
        unique = db.query(func.count(func.distinct(CreatorEvent.actor_id))).filter(
            CreatorEvent.event_type == "POST_VIEW", CreatorEvent.content_type == "POST", CreatorEvent.content_id == item.id,
            CreatorEvent.day >= start, CreatorEvent.day <= end).scalar() or 0
        split = dict(db.query(CreatorEvent.audience_kind, func.count(CreatorEvent.id)).filter(
            CreatorEvent.event_type == "POST_VIEW", CreatorEvent.content_type == "POST", CreatorEvent.content_id == item.id,
            CreatorEvent.day >= start, CreatorEvent.day <= end).group_by(CreatorEvent.audience_kind))
        def count(model, timestamp, *extra):
            return db.query(func.count(model.id)).filter(model.post_id == item.id,
                timestamp >= first, timestamp < until, *extra).scalar() or 0
        likes = count(PostReaction, PostReaction.created_at)
        comments = count(Comment, Comment.created_at, Comment.deleted_at.is_(None))
        saves = count(Bookmark, Bookmark.created_at)
        shares = db.query(func.count(CreatorEvent.id)).filter(CreatorEvent.event_type == "POST_SHARE",
            CreatorEvent.content_id == item.id, CreatorEvent.day >= start, CreatorEvent.day <= end).scalar() or 0
        url = f"/posts/{item.id}"
        preview = item.content[:160] or "Media post"
        published_at = item.created_at
        media_url = item.media_url
    elif kind == "REEL":
        views = db.query(ReelView).filter(ReelView.reel_id == item.id, ReelView.user_id != item.creator_id,
            ReelView.created_at >= first, ReelView.created_at < until)
        view_count = views.count()
        unique = db.query(func.count(func.distinct(ReelView.user_id))).filter(ReelView.reel_id == item.id,
            ReelView.user_id != item.creator_id, ReelView.created_at >= first, ReelView.created_at < until).scalar() or 0
        split = dict(db.query(ReelView.audience_kind, func.count(ReelView.id)).filter(ReelView.reel_id == item.id,
            ReelView.user_id != item.creator_id, ReelView.created_at >= first, ReelView.created_at < until).group_by(ReelView.audience_kind))
        def count(model, timestamp, *extra):
            return db.query(func.count(model.id)).filter(model.reel_id == item.id,
                timestamp >= first, timestamp < until, *extra).scalar() or 0
        likes = count(ReelLike, ReelLike.created_at)
        comments = count(ReelComment, ReelComment.created_at, ReelComment.deleted_at.is_(None))
        saves = count(ReelBookmark, ReelBookmark.created_at)
        shares = count(ReelShare, ReelShare.created_at)
        url = f"/reels?id={item.public_id}"
        preview = item.caption[:160] or "Reel"
        published_at = item.published_at or item.created_at
        from app.services.reel_service import signed_url
        media_url = signed_url(item, user_id, "thumbnail")
    else:
        views = db.query(StoryView).filter(StoryView.story_id == item.id,
            StoryView.viewed_at >= first, StoryView.viewed_at < until)
        view_count = views.count()
        unique = view_count
        split = dict(db.query(StoryView.audience_kind, func.count(StoryView.id)).filter(
            StoryView.story_id == item.id, StoryView.viewed_at >= first,
            StoryView.viewed_at < until).group_by(StoryView.audience_kind))
        likes = comments = shares = saves = 0
        url = "/"
        preview = (item.caption or "Story")[:160]
        published_at = item.created_at
        media_url = item.media_url
    rate = round(100 * (likes + comments + shares + saves) / view_count, 2) if view_count else None
    return {"kind": kind, "id": item.id, "url": url, "preview": preview,
            "media_url": media_url, "published_at": published_at.isoformat() if published_at else None,
            "views": view_count, "unique_viewers": unique, "reach": unique,
            "likes": likes, "comments": comments, "shares": shares, "saves": saves,
            "engagement_rate": rate,
            "audience": {"followers": split.get("FOLLOWER", 0),
                         "non_followers": split.get("NON_FOLLOWER", 0),
                         "unknown": split.get("UNKNOWN", 0) + split.get("OWNER", 0)}}


def ranked_content(db: Session, user_id: int, kind: str, sort: str,
                   start: date, end: date, limit: int, offset: int):
    """Sort and page content in SQL before loading individual insight cards."""
    first, until = bounds(start, end)

    def counts(model, id_column, stamp, *filters):
        return db.query(id_column.label("content_id"), func.count(model.id).label("total")).filter(
            stamp >= first, stamp < until, *filters).group_by(id_column).subquery()

    post_views = db.query(CreatorEvent.content_id.label("content_id"), func.count(CreatorEvent.id).label("total")).filter(
        CreatorEvent.event_type == "POST_VIEW", CreatorEvent.content_type == "POST",
        CreatorEvent.day >= start, CreatorEvent.day <= end).group_by(CreatorEvent.content_id).subquery()
    post_shares = db.query(CreatorEvent.content_id.label("content_id"), func.count(CreatorEvent.id).label("total")).filter(
        CreatorEvent.event_type == "POST_SHARE", CreatorEvent.content_type == "POST",
        CreatorEvent.day >= start, CreatorEvent.day <= end).group_by(CreatorEvent.content_id).subquery()
    post_likes = counts(PostReaction, PostReaction.post_id, PostReaction.created_at)
    post_comments = counts(Comment, Comment.post_id, Comment.created_at, Comment.deleted_at.is_(None))
    post_saves = counts(Bookmark, Bookmark.post_id, Bookmark.created_at)
    reel_views = db.query(ReelView.reel_id.label("content_id"), func.count(ReelView.id).label("total")).join(
        Reel, Reel.id == ReelView.reel_id).filter(ReelView.created_at >= first,
        ReelView.created_at < until, ReelView.user_id != Reel.creator_id).group_by(ReelView.reel_id).subquery()
    reel_likes = counts(ReelLike, ReelLike.reel_id, ReelLike.created_at)
    reel_comments = counts(ReelComment, ReelComment.reel_id, ReelComment.created_at, ReelComment.deleted_at.is_(None))
    reel_shares = counts(ReelShare, ReelShare.reel_id, ReelShare.created_at)
    reel_saves = counts(ReelBookmark, ReelBookmark.reel_id, ReelBookmark.created_at)
    story_views = counts(StoryView, StoryView.story_id, StoryView.viewed_at)

    def columns(label, model, published, views, likes, comments, shares, saves):
        return (literal(label).label("kind"), model.id.label("item_id"),
                published.label("published_at"), func.coalesce(views.c.total, 0).label("views"),
                func.coalesce(likes.c.total, 0).label("likes") if likes is not None else literal(0).label("likes"),
                func.coalesce(comments.c.total, 0).label("comments") if comments is not None else literal(0).label("comments"),
                func.coalesce(shares.c.total, 0).label("shares") if shares is not None else literal(0).label("shares"),
                func.coalesce(saves.c.total, 0).label("saves") if saves is not None else literal(0).label("saves"))

    queries = []
    if kind in {"all", "posts", "collaborative"}:
        scope = Post.id.in_(accepted_post_ids(db, user_id)) if kind == "collaborative" else post_scope(db, user_id)
        q = db.query(*columns("POST", Post, Post.created_at, post_views, post_likes, post_comments, post_shares, post_saves)).outerjoin(
            post_views, post_views.c.content_id == Post.id).outerjoin(
            post_likes, post_likes.c.content_id == Post.id).outerjoin(
            post_comments, post_comments.c.content_id == Post.id).outerjoin(
            post_shares, post_shares.c.content_id == Post.id).outerjoin(
            post_saves, post_saves.c.content_id == Post.id).filter(scope, Post.deleted_at.is_(None),
            Post.created_at >= first, Post.created_at < until)
        queries.append(q.statement)
    if kind in {"all", "reels"}:
        q = db.query(*columns("REEL", Reel, Reel.published_at, reel_views, reel_likes, reel_comments, reel_shares, reel_saves)).outerjoin(
            reel_views, reel_views.c.content_id == Reel.id).outerjoin(
            reel_likes, reel_likes.c.content_id == Reel.id).outerjoin(
            reel_comments, reel_comments.c.content_id == Reel.id).outerjoin(
            reel_shares, reel_shares.c.content_id == Reel.id).outerjoin(
            reel_saves, reel_saves.c.content_id == Reel.id).filter(Reel.creator_id == user_id,
            Reel.status == "PUBLISHED", Reel.deleted_at.is_(None),
            Reel.published_at >= first, Reel.published_at < until)
        queries.append(q.statement)
    if kind in {"all", "stories"}:
        q = db.query(*columns("STORY", Story, Story.created_at, story_views, None, None, None, None)).outerjoin(
            story_views, story_views.c.content_id == Story.id).filter(Story.user_id == user_id,
            Story.created_at >= first, Story.created_at < until)
        queries.append(q.statement)
    ranked = union_all(*queries).subquery()
    total = db.query(func.count()).select_from(ranked).scalar() or 0
    if sort == "latest":
        sort_column = ranked.c.published_at
    elif sort == "engagement":
        sort_column = (ranked.c.likes + ranked.c.comments + ranked.c.shares + ranked.c.saves) * 100.0 / func.nullif(ranked.c.views, 0)
    else:
        sort_column = getattr(ranked.c, sort)
    keys = db.query(ranked.c.kind, ranked.c.item_id).order_by(
        sort_column.desc().nullslast(), ranked.c.published_at.desc(), ranked.c.item_id.desc()).offset(offset).limit(limit).all()
    return total, keys


def item_trends(db: Session, kind: str, item_id: int, start: date, end: date) -> list[dict]:
    first, until = bounds(start, end)
    dates = {}
    if kind == "POST":
        views = db.query(CreatorEvent.day, func.count(CreatorEvent.id)).filter(
            CreatorEvent.event_type == "POST_VIEW", CreatorEvent.content_type == "POST",
            CreatorEvent.content_id == item_id, CreatorEvent.day >= start,
            CreatorEvent.day <= end).group_by(CreatorEvent.day)
        engagements = ((PostReaction, PostReaction.post_id, PostReaction.created_at),
                       (Comment, Comment.post_id, Comment.created_at),
                       (Bookmark, Bookmark.post_id, Bookmark.created_at))
    elif kind == "REEL":
        views = db.query(func.date(ReelView.created_at), func.count(ReelView.id)).join(
            Reel, Reel.id == ReelView.reel_id).filter(
            ReelView.reel_id == item_id, ReelView.user_id != Reel.creator_id, ReelView.created_at >= first,
            ReelView.created_at < until).group_by(func.date(ReelView.created_at))
        engagements = ((ReelLike, ReelLike.reel_id, ReelLike.created_at),
                       (ReelComment, ReelComment.reel_id, ReelComment.created_at),
                       (ReelBookmark, ReelBookmark.reel_id, ReelBookmark.created_at),
                       (ReelShare, ReelShare.reel_id, ReelShare.created_at))
    else:
        views = db.query(func.date(StoryView.viewed_at), func.count(StoryView.id)).filter(
            StoryView.story_id == item_id, StoryView.viewed_at >= first,
            StoryView.viewed_at < until).group_by(func.date(StoryView.viewed_at))
        engagements = ()
    for day, count in views:
        dates.setdefault(str(day)[:10], {"views": 0, "engagements": 0})["views"] += count
    for model, fk, stamp in engagements:
        q = db.query(func.date(stamp), func.count(model.id)).filter(fk == item_id,
            stamp >= first, stamp < until)
        if model in {Comment, ReelComment}:
            q = q.filter(model.deleted_at.is_(None))
        for day, count in q.group_by(func.date(stamp)):
            dates.setdefault(str(day)[:10], {"views": 0, "engagements": 0})["engagements"] += count
    if kind == "POST":
        for day, count in db.query(CreatorEvent.day, func.count(CreatorEvent.id)).filter(
            CreatorEvent.event_type == "POST_SHARE", CreatorEvent.content_type == "POST",
            CreatorEvent.content_id == item_id, CreatorEvent.day >= start,
            CreatorEvent.day <= end).group_by(CreatorEvent.day):
            dates.setdefault(str(day)[:10], {"views": 0, "engagements": 0})["engagements"] += count
    return [{"date": day.isoformat(), **dates.get(day.isoformat(), {"views": 0, "engagements": 0})}
            for day in (start + timedelta(days=i) for i in range((end - start).days + 1))]
