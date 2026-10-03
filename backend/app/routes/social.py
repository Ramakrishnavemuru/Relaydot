"""REST API for the social layer; chat and stories retain their existing routes."""
import re
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session
from app.database import get_db
from app.security.dependencies import get_current_user
from app.models.user import User
from app.models.block import BlockedUser
from app.models.conversation import Conversation, ConversationMember
from app.models.social import (Bookmark, Comment, CommentReaction, Community, CommunityMember,
    Follow, Hashtag, PollOption, PollVote, Post, PostHashtag, PostMention,
    PostReaction, Report, SocialNotification)
from app.schemas.social import (CommentCreate, CommunityCreate, CommunityEdit, MemberRole,
    NotificationRead, PostCreate, PostEdit, ReactionCreate, ReportCreate, ShareCreate, VoteCreate)
from app.schemas.message import MessageCreate
from app.services.feed_service import FeedService
from app.services.message_service import MessageService
from app.services.user_service import UserService
from app.services.rate_limit import throttle
from app.websocket.manager import manager

router = APIRouter(prefix="/social", tags=["Social"])
HASHTAG = re.compile(r"(?<!\w)#([A-Za-z0-9_]{1,50})\b")
MENTION = re.compile(r"(?<!\w)@([A-Za-z0-9_]{3,30})\b")
def user_or_404(db: Session, user_id: int, viewer_id: int) -> User:
    user = db.get(User, user_id)
    if not user or (viewer_id != user_id and UserService.is_blocked(db, viewer_id, user_id)):
        raise HTTPException(404, "User not found")
    return user


def post_or_404(db: Session, post_id: int, viewer_id: int) -> Post:
    post = db.get(Post, post_id)
    if not post or not FeedService.can_view(db, post, viewer_id):
        raise HTTPException(404, "Post not found")
    return post


def member(db: Session, community_id: int, user_id: int) -> CommunityMember | None:
    return db.query(CommunityMember).filter_by(community_id=community_id, user_id=user_id).first()


def community_or_404(db: Session, community_id: int) -> Community:
    community = db.get(Community, community_id)
    if not community:
        raise HTTPException(404, "Community not found")
    return community


def media_url_valid(url: str, media_type: str) -> bool:
    parsed = urlparse(url)
    extension = parsed.path.rsplit(".", 1)[-1].lower()
    allowed = {"IMAGE": {"png", "jpg", "jpeg", "webp"},
               "GIF": {"gif"}, "VIDEO": {"mp4", "webm"}}
    return extension in allowed.get(media_type, set()) and (
        url.startswith("/uploads/") or
        (parsed.scheme == "https" and parsed.hostname in {"res.cloudinary.com"}))


def uploaded_image_or_none(url: str | None):
    if url is None:
        return None
    if not media_url_valid(url, "IMAGE") and not media_url_valid(url, "GIF"):
        raise HTTPException(400, "Choose an uploaded image")
    if any(c in url for c in "'\"()\\"):
        raise HTTPException(400, "Invalid image URL")
    return url


async def notify(db: Session, recipient_id: int, actor_id: int, kind: str, entity_type: str, entity_id: int):
    if recipient_id == actor_id or UserService.is_blocked(db, recipient_id, actor_id):
        return
    item = SocialNotification(recipient_id=recipient_id, actor_id=actor_id,
        type=kind, entity_type=entity_type, entity_id=entity_id)
    db.add(item)
    db.commit()
    await manager.send_to_user(recipient_id, {"event": "social_notification", "data": notification_dict(item)})


def notification_dict(item: SocialNotification) -> dict:
    actor = item.actor
    return {"id": item.id, "type": item.type, "entity_type": item.entity_type,
        "entity_id": item.entity_id, "read": item.read,
        "created_at": FeedService.iso(item.created_at),
        "actor": actor.to_dict(False) if actor else None}


async def index_text(db: Session, post: Post, actor_id: int):
    db.query(PostHashtag).filter_by(post_id=post.id).delete()
    db.query(PostMention).filter_by(post_id=post.id).delete()
    for name in {x.lower() for x in HASHTAG.findall(post.content)}:
        tag = db.query(Hashtag).filter_by(name=name).first()
        if not tag:
            tag = Hashtag(name=name)
            db.add(tag)
            db.flush()
        db.add(PostHashtag(post_id=post.id, hashtag_id=tag.id))
    mentioned = []
    for name in {x.lower() for x in MENTION.findall(post.content)}:
        user = db.query(User).filter(func.lower(User.username) == name).first()
        if user and user.id != actor_id and not UserService.is_blocked(db, actor_id, user.id):
            db.add(PostMention(post_id=post.id, user_id=user.id))
            mentioned.append(user.id)
    db.commit()
    for uid in mentioned:
        if FeedService.can_view(db, post, uid):
            await notify(db, uid, actor_id, "mention", "post", post.id)


@router.post("/posts", status_code=201)
async def create_post(data: PostCreate, current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    throttle(current.id, "post", 12)
    if not data.content.strip() and not data.media_url and not data.quote_of_id and not data.poll_options:
        raise HTTPException(400, "Add text, media, a quote, or a poll")
    if bool(data.media_url) != bool(data.media_type) or (data.media_url and not media_url_valid(data.media_url, data.media_type)):
        raise HTTPException(400, "Unsupported media. Upload an image or video first.")
    if data.community_id and not member(db, data.community_id, current.id):
        raise HTTPException(403, "Join the community before posting")
    if data.quote_of_id:
        quoted = post_or_404(db, data.quote_of_id, current.id)
        if quoted.visibility != "EVERYONE":
            raise HTTPException(403, "Restricted posts cannot be quoted")
    if data.thread_parent_id:
        parent = post_or_404(db, data.thread_parent_id, current.id)
        if parent.author_id != current.id:
            raise HTTPException(403, "You can only extend your own thread")
    post = Post(author_id=current.id, content=data.content.strip(), media_url=data.media_url,
        media_type=data.media_type, visibility=data.visibility, reply_policy=data.reply_policy,
        community_id=data.community_id, quote_of_id=data.quote_of_id,
        thread_parent_id=data.thread_parent_id)
    db.add(post)
    db.flush()
    for position, label in enumerate(data.poll_options or []):
        db.add(PollOption(post_id=post.id, label=label.strip(), position=position))
    db.commit()
    await index_text(db, post, current.id)
    if data.quote_of_id:
        original = db.get(Post, data.quote_of_id)
        await notify(db, original.author_id, current.id, "quote", "post", post.id)
    if data.community_id:
        member_ids = [row[0] for row in db.query(CommunityMember.user_id).filter_by(community_id=data.community_id)]
        for recipient_id in member_ids:
            await notify(db, recipient_id, current.id, "community_post", "post", post.id)
    return FeedService.serialize(db, post, current.id)


@router.get("/feed")
def feed(mode: str = Query("for_you", pattern="^(for_you|following)$"), limit: int = Query(15, ge=1, le=30),
         offset: int = Query(0, ge=0, le=10000), current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    posts = FeedService.feed(db, current.id, mode, limit, offset)
    return {"items": FeedService.serialize_many(db, posts, current.id),
            "next_offset": offset + len(posts) if len(posts) == limit else None}


@router.get("/posts/{post_id}")
def get_post(post_id: int, current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return FeedService.serialize(db, post_or_404(db, post_id, current.id), current.id)


@router.patch("/posts/{post_id}")
async def edit_post(post_id: int, data: PostEdit, current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    post = post_or_404(db, post_id, current.id)
    if post.author_id != current.id or post.repost_of_id:
        raise HTTPException(403, "You can only edit your own original post")
    if not data.content.strip() and not post.media_url and not post.quote_of_id and not db.query(PollOption.id).filter_by(post_id=post.id).first():
        raise HTTPException(400, "Post cannot be empty")
    post.content = data.content.strip()
    post.edited_at = datetime.now(timezone.utc)
    if data.visibility:
        post.visibility = data.visibility
    if data.reply_policy:
        post.reply_policy = data.reply_policy
    db.commit()
    await index_text(db, post, current.id)
    return FeedService.serialize(db, post, current.id)


@router.delete("/posts/{post_id}")
def delete_post(post_id: int, current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    post = post_or_404(db, post_id, current.id)
    if post.author_id != current.id:
        raise HTTPException(403, "You can only delete your own post")
    post.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"deleted": True}


@router.post("/posts/{post_id}/reaction")
async def react_post(post_id: int, data: ReactionCreate, current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    throttle(current.id, "reaction", 60)
    post = post_or_404(db, post_id, current.id)
    existing = db.query(PostReaction).filter_by(post_id=post_id, user_id=current.id).first()
    if existing:
        existing.emoji = data.emoji
    else:
        db.add(PostReaction(post_id=post_id, user_id=current.id, emoji=data.emoji))
    db.commit()
    if not existing:
        await notify(db, post.author_id, current.id, "like", "post", post.id)
    return FeedService.serialize(db, post, current.id)


@router.delete("/posts/{post_id}/reaction")
def unreact_post(post_id: int, current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    post = post_or_404(db, post_id, current.id)
    db.query(PostReaction).filter_by(post_id=post_id, user_id=current.id).delete()
    db.commit()
    return FeedService.serialize(db, post, current.id)


@router.post("/posts/{post_id}/bookmark")
def bookmark(post_id: int, current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    post = post_or_404(db, post_id, current.id)
    if not db.query(Bookmark).filter_by(post_id=post_id, user_id=current.id).first():
        db.add(Bookmark(post_id=post_id, user_id=current.id)); db.commit()
    return FeedService.serialize(db, post, current.id)


@router.delete("/posts/{post_id}/bookmark")
def unbookmark(post_id: int, current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    post = post_or_404(db, post_id, current.id)
    db.query(Bookmark).filter_by(post_id=post_id, user_id=current.id).delete(); db.commit()
    return FeedService.serialize(db, post, current.id)


@router.get("/bookmarks")
def bookmarks(limit: int = Query(15, ge=1, le=30), offset: int = Query(0, ge=0),
              current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    posts = FeedService.visible_query(db, current.id).join(Bookmark, Bookmark.post_id == Post.id).filter(
        Bookmark.user_id == current.id).order_by(Bookmark.created_at.desc()).offset(offset).limit(limit).all()
    return {"items": FeedService.serialize_many(db, posts, current.id),
            "next_offset": offset + len(posts) if len(posts) == limit else None}


def comment_dict(db: Session, comment: Comment, viewer_id: int) -> dict:
    likes = db.query(func.count(CommentReaction.id)).filter_by(comment_id=comment.id).scalar() or 0
    mine = db.query(CommentReaction.id).filter_by(comment_id=comment.id, user_id=viewer_id).first() is not None
    return {"id": comment.id, "post_id": comment.post_id, "parent_id": comment.parent_id,
        "content": comment.content, "author": comment.author.to_dict(False),
        "created_at": FeedService.iso(comment.created_at), "likes_count": likes, "liked": mine}


@router.get("/posts/{post_id}/comments")
def comments(post_id: int, limit: int = Query(20, ge=1, le=50), offset: int = Query(0, ge=0),
             current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    post_or_404(db, post_id, current.id)
    rows = db.query(Comment).filter_by(post_id=post_id, deleted_at=None).order_by(
        Comment.created_at.asc(), Comment.id.asc()).offset(offset).limit(limit).all()
    return {"items": [comment_dict(db, c, current.id) for c in rows],
            "next_offset": offset + len(rows) if len(rows) == limit else None}


@router.post("/posts/{post_id}/comments", status_code=201)
async def add_comment(post_id: int, data: CommentCreate, current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    throttle(current.id, "comment", 30)
    post = post_or_404(db, post_id, current.id)
    if post.reply_policy == "NOBODY" and post.author_id != current.id:
        raise HTTPException(403, "Replies are disabled")
    if post.reply_policy == "FOLLOWERS" and post.author_id != current.id and not db.query(Follow.id).filter_by(
        follower_id=current.id, following_id=post.author_id).first():
        raise HTTPException(403, "Only followers can reply")
    if post.reply_policy == "FOLLOWING" and post.author_id != current.id and not db.query(Follow.id).filter_by(
        follower_id=post.author_id, following_id=current.id).first():
        raise HTTPException(403, "Only people the author follows can reply")
    parent = None
    if data.parent_id:
        parent = db.query(Comment).filter_by(id=data.parent_id, post_id=post_id, deleted_at=None).first()
        if not parent:
            raise HTTPException(404, "Parent comment not found")
        if parent.parent_id:
            raise HTTPException(400, "Replies can only be one level deep")
    comment = Comment(post_id=post_id, author_id=current.id, parent_id=data.parent_id, content=data.content.strip())
    db.add(comment); db.commit()
    await notify(db, parent.author_id if parent else post.author_id, current.id,
        "reply" if parent else "comment", "post", post_id)
    for name in {x.lower() for x in MENTION.findall(comment.content)}:
        mentioned = db.query(User).filter(func.lower(User.username) == name).first()
        if mentioned and FeedService.can_view(db, post, mentioned.id):
            await notify(db, mentioned.id, current.id, "mention", "post", post_id)
    return comment_dict(db, comment, current.id)


@router.delete("/comments/{comment_id}")
def delete_comment(comment_id: int, current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    comment = db.get(Comment, comment_id)
    if not comment or not FeedService.can_view(db, db.get(Post, comment.post_id), current.id):
        raise HTTPException(404, "Comment not found")
    if comment.author_id != current.id:
        raise HTTPException(403, "You can only delete your own comment")
    comment.deleted_at = datetime.now(timezone.utc); db.commit()
    return {"deleted": True}


@router.post("/comments/{comment_id}/like")
def like_comment(comment_id: int, current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    throttle(current.id, "reaction", 60)
    comment = db.get(Comment, comment_id)
    if not comment or comment.deleted_at or not FeedService.can_view(db, db.get(Post, comment.post_id), current.id):
        raise HTTPException(404, "Comment not found")
    if not db.query(CommentReaction.id).filter_by(comment_id=comment_id, user_id=current.id).first():
        db.add(CommentReaction(comment_id=comment_id, user_id=current.id)); db.commit()
    return comment_dict(db, comment, current.id)


@router.delete("/comments/{comment_id}/like")
def unlike_comment(comment_id: int, current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    comment = db.get(Comment, comment_id)
    if not comment or not FeedService.can_view(db, db.get(Post, comment.post_id), current.id):
        raise HTTPException(404, "Comment not found")
    db.query(CommentReaction).filter_by(comment_id=comment_id, user_id=current.id).delete(); db.commit()
    return comment_dict(db, comment, current.id)


@router.post("/posts/{post_id}/repost", status_code=201)
async def repost(post_id: int, current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    throttle(current.id, "post", 12)
    original = post_or_404(db, post_id, current.id)
    if original.visibility != "EVERYONE":
        raise HTTPException(403, "Restricted posts cannot be reposted")
    existing = db.query(Post).filter_by(author_id=current.id, repost_of_id=post_id).first()
    if existing:
        if existing.deleted_at:
            existing.deleted_at = None
            existing.created_at = datetime.now(timezone.utc)
            db.commit()
        return FeedService.serialize(db, existing, current.id)
    shared = Post(author_id=current.id, repost_of_id=post_id, content="", visibility="EVERYONE")
    db.add(shared); db.commit()
    await notify(db, original.author_id, current.id, "repost", "post", shared.id)
    return FeedService.serialize(db, shared, current.id)


@router.post("/posts/{post_id}/vote")
def vote(post_id: int, data: VoteCreate, current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    post = post_or_404(db, post_id, current.id)
    option = db.query(PollOption).filter_by(id=data.option_id, post_id=post_id).first()
    if not option:
        raise HTTPException(404, "Poll option not found")
    if db.query(PollVote).filter_by(post_id=post_id, user_id=current.id).first():
        raise HTTPException(409, "You have already voted")
    db.add(PollVote(post_id=post_id, option_id=option.id, user_id=current.id)); db.commit()
    return FeedService.serialize(db, post, current.id)


@router.post("/posts/{post_id}/share-to-chat")
async def share_to_chat(post_id: int, data: ShareCreate, current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    throttle(current.id, "share", 30)
    post = post_or_404(db, post_id, current.id)
    members = db.query(ConversationMember).filter_by(conversation_id=data.conversation_id).all()
    if not any(m.user_id == current.id for m in members):
        raise HTTPException(403, "Not a conversation member")
    for m in members:
        if not FeedService.can_view(db, post, m.user_id):
            raise HTTPException(403, "Some recipients cannot view this post")
    preview = post.content[:130].replace("\n", " ") or ("Media post" if post.media_url else "Post")
    content = f"Shared post by {post.author.display_name or post.author.username}\n{preview}\n/post/{post.id}"
    return await MessageService.send_message(db, current.id,
        MessageCreate(conversation_id=data.conversation_id, content=content, message_type="TEXT"))


@router.get("/posts/{post_id}/thread")
def thread(post_id: int, current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    post = post_or_404(db, post_id, current.id)
    root_id = post.thread_parent_id or post.id
    rows = FeedService.visible_query(db, current.id).filter(or_(Post.id == root_id,
        Post.thread_parent_id == root_id)).order_by(Post.created_at).limit(30).all()
    return FeedService.serialize_many(db, rows, current.id)


def profile_dict(db: Session, user: User, viewer_id: int) -> dict:
    data = user.to_dict(False)
    data.update({"cover_url": user.cover_url, "website": user.website,
        "posts_count": FeedService.visible_query(db, viewer_id).filter(Post.author_id == user.id).count(),
        "followers_count": db.query(func.count(Follow.id)).filter_by(following_id=user.id).scalar() or 0,
        "following_count": db.query(func.count(Follow.id)).filter_by(follower_id=user.id).scalar() or 0,
        "is_following": db.query(Follow.id).filter_by(follower_id=viewer_id, following_id=user.id).first() is not None})
    return data


@router.get("/profiles/{user_id}")
def profile(user_id: int, current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return profile_dict(db, user_or_404(db, user_id, current.id), current.id)


@router.get("/profiles/{user_id}/posts")
def profile_posts(user_id: int, tab: str = Query("posts", pattern="^(posts|replies|media)$"),
                  limit: int = Query(15, ge=1, le=30), offset: int = Query(0, ge=0),
                  current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    user_or_404(db, user_id, current.id)
    if tab == "replies":
        visible_posts = FeedService.visible_query(db, current.id).with_entities(Post.id).subquery()
        comments = db.query(Comment).filter_by(author_id=user_id, deleted_at=None).filter(
            Comment.post_id.in_(db.query(visible_posts.c.id))).order_by(
            Comment.created_at.desc()).offset(offset).limit(limit).all()
        items = [{"comment": comment_dict(db, c, current.id),
            "post": FeedService.serialize(db, db.get(Post, c.post_id), current.id)}
            for c in comments]
    else:
        q = FeedService.visible_query(db, current.id).filter(Post.author_id == user_id)
        if tab == "media":
            q = q.filter(Post.media_url.isnot(None))
        rows = q.order_by(Post.created_at.desc()).offset(offset).limit(limit).all()
        items = FeedService.serialize_many(db, rows, current.id)
    return {"items": items, "next_offset": offset + len(items) if len(items) == limit else None}


@router.post("/profiles/{user_id}/follow")
async def follow(user_id: int, current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    throttle(current.id, "follow", 40)
    if user_id == current.id:
        raise HTTPException(400, "You cannot follow yourself")
    user_or_404(db, user_id, current.id)
    if not db.query(Follow).filter_by(follower_id=current.id, following_id=user_id).first():
        db.add(Follow(follower_id=current.id, following_id=user_id)); db.commit()
        await notify(db, user_id, current.id, "follow", "user", current.id)
    return {"following": True}


@router.delete("/profiles/{user_id}/follow")
def unfollow(user_id: int, current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.query(Follow).filter_by(follower_id=current.id, following_id=user_id).delete(); db.commit()
    return {"following": False}


@router.get("/profiles/{user_id}/followers")
def followers(user_id: int, limit: int = Query(20, ge=1, le=50), offset: int = Query(0, ge=0),
              current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    user_or_404(db, user_id, current.id)
    ids = [row[0] for row in db.query(Follow.follower_id).filter_by(following_id=user_id).order_by(
        Follow.created_at.desc()).offset(offset).limit(limit)]
    return {"items": [profile_dict(db, db.get(User, uid), current.id) for uid in ids
        if not UserService.is_blocked(db, uid, current.id)],
        "next_offset": offset + len(ids) if len(ids) == limit else None}


@router.get("/profiles/{user_id}/following")
def following(user_id: int, limit: int = Query(20, ge=1, le=50), offset: int = Query(0, ge=0),
              current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    user_or_404(db, user_id, current.id)
    ids = [row[0] for row in db.query(Follow.following_id).filter_by(follower_id=user_id).order_by(
        Follow.created_at.desc()).offset(offset).limit(limit)]
    return {"items": [profile_dict(db, db.get(User, uid), current.id) for uid in ids
        if not UserService.is_blocked(db, uid, current.id)],
        "next_offset": offset + len(ids) if len(ids) == limit else None}


@router.get("/search")
def search(q: str = Query(..., min_length=1, max_length=100), kind: str = Query("all", pattern="^(all|people|posts|communities|topics)$"),
           limit: int = Query(10, ge=1, le=30), offset: int = Query(0, ge=0),
           current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    throttle(current.id, "search", 120)
    term = q.strip()
    if not term:
        return {"people": [], "posts": [], "communities": [], "topics": []}
    escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    pattern = f"%{escaped}%"
    blocked = FeedService.blocked_ids(db, current.id)
    result = {"people": [], "posts": [], "communities": [], "topics": []}
    if kind in ("all", "people"):
        people = db.query(User).filter(User.id.notin_(blocked or [-1]), User.id != current.id,
            or_(User.username.ilike(pattern, escape="\\"), User.display_name.ilike(pattern, escape="\\")))\
            .order_by(User.username).offset(offset).limit(limit).all()
        result["people"] = [profile_dict(db, u, current.id) for u in people]
    if kind in ("all", "posts"):
        posts = FeedService.visible_query(db, current.id).filter(Post.content.ilike(pattern, escape="\\"))\
            .order_by(Post.created_at.desc()).offset(offset).limit(limit).all()
        result["posts"] = FeedService.serialize_many(db, posts, current.id)
    if kind in ("all", "communities"):
        communities = db.query(Community).filter(or_(Community.name.ilike(pattern, escape="\\"),
            Community.description.ilike(pattern, escape="\\"))).order_by(Community.created_at.desc()).offset(offset).limit(limit).all()
        result["communities"] = [community_dict(db, c, current.id) for c in communities]
    if kind in ("all", "topics"):
        topic_term = term.lstrip('#').replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
        visible = FeedService.visible_query(db, current.id).with_entities(Post.id).subquery()
        tags = db.query(Hashtag).join(PostHashtag, PostHashtag.hashtag_id == Hashtag.id)\
            .join(visible, visible.c.id == PostHashtag.post_id)\
            .filter(Hashtag.name.ilike(f"%{topic_term}%", escape="\\")).distinct()\
            .order_by(Hashtag.name).offset(offset).limit(limit).all()
        result["topics"] = [{"name": t.name} for t in tags]
    return result


@router.get("/trending")
def trending(current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    since = datetime.now(timezone.utc) - timedelta(hours=48)
    visible = FeedService.visible_query(db, current.id).subquery()
    rows = db.query(Hashtag.name, func.count(PostHashtag.post_id).label("posts"),
        func.max(Post.created_at).label("latest")).join(PostHashtag, PostHashtag.hashtag_id == Hashtag.id)\
        .join(Post, Post.id == PostHashtag.post_id).join(visible, visible.c.id == Post.id)\
        .filter(Post.created_at >= since).group_by(Hashtag.id).order_by(
            func.count(PostHashtag.post_id).desc(), func.max(Post.created_at).desc()).limit(10).all()
    return [{"name": name, "posts": count} for name, count, _ in rows]


@router.get("/hashtags/{name}")
def hashtag(name: str, limit: int = Query(15, ge=1, le=30), offset: int = Query(0, ge=0),
            current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    name = name.lower().lstrip("#")
    if not re.fullmatch(r"[a-z0-9_]{1,50}", name):
        raise HTTPException(400, "Invalid hashtag")
    tag = db.query(Hashtag).filter_by(name=name).first()
    if not tag:
        return {"name": name, "count": 0, "items": [], "next_offset": None}
    q = FeedService.visible_query(db, current.id).join(PostHashtag, PostHashtag.post_id == Post.id).filter(
        PostHashtag.hashtag_id == tag.id)
    count = q.count()
    rows = q.order_by(Post.created_at.desc()).offset(offset).limit(limit).all()
    return {"name": name, "count": count, "items": FeedService.serialize_many(db, rows, current.id),
        "next_offset": offset + len(rows) if len(rows) == limit else None}


@router.get("/mentions/suggestions")
def mention_suggestions(q: str = Query(..., min_length=1, max_length=30),
                        current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    throttle(current.id, "search", 120)
    return UserService.search_users(db, q, current.id)[:8]


@router.get("/notifications")
def notifications(limit: int = Query(25, ge=1, le=50), offset: int = Query(0, ge=0),
                  current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.query(SocialNotification).filter_by(recipient_id=current.id).order_by(
        SocialNotification.created_at.desc(), SocialNotification.id.desc()).offset(offset).limit(limit).all()
    return {"items": [notification_dict(n) for n in rows],
        "unread": db.query(func.count(SocialNotification.id)).filter_by(recipient_id=current.id, read=False).scalar() or 0,
        "next_offset": offset + len(rows) if len(rows) == limit else None}


@router.post("/notifications/read")
def mark_notifications_read(data: NotificationRead, current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    q = db.query(SocialNotification).filter_by(recipient_id=current.id, read=False)
    if data.ids is not None:
        q = q.filter(SocialNotification.id.in_(data.ids[:100]))
    count = q.update({"read": True}, synchronize_session=False); db.commit()
    return {"updated": count}


@router.post("/reports", status_code=201)
def report(data: ReportCreate, current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    throttle(current.id, "report", 10, 3600)
    model = {"post": Post, "comment": Comment, "user": User, "community": Community}[data.entity_type]
    target = db.get(model, data.entity_id)
    if not target:
        raise HTTPException(404, "Content not found")
    if data.entity_type == "post":
        post_or_404(db, data.entity_id, current.id)
    if data.entity_type == "comment":
        post_or_404(db, target.post_id, current.id)
    if data.entity_type == "user":
        user_or_404(db, data.entity_id, current.id)
    existing = db.query(Report).filter_by(reporter_id=current.id,
        entity_type=data.entity_type, entity_id=data.entity_id).first()
    if not existing:
        db.add(Report(reporter_id=current.id, entity_type=data.entity_type,
            entity_id=data.entity_id, reason=data.reason, details=data.details)); db.commit()
    return {"reported": True}


def community_dict(db: Session, community: Community, viewer_id: int) -> dict:
    membership = member(db, community.id, viewer_id)
    return {"id": community.id, "name": community.name,
        "description": community.description, "avatar_url": community.avatar_url,
        "banner_url": community.banner_url, "owner_id": community.owner_id,
        "conversation_id": community.conversation_id if membership else None,
        "member_count": db.query(func.count(CommunityMember.id)).filter_by(community_id=community.id).scalar() or 0,
        "my_role": membership.role if membership else None,
        "created_at": FeedService.iso(community.created_at)}


@router.get("/communities")
def communities(q: str = Query("", max_length=100), limit: int = Query(20, ge=1, le=50),
                offset: int = Query(0, ge=0), current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    query = db.query(Community)
    if q.strip():
        query = query.filter(Community.name.ilike(f"%{q.strip()}%"))
    rows = query.order_by(Community.created_at.desc()).offset(offset).limit(limit).all()
    return {"items": [community_dict(db, c, current.id) for c in rows],
        "next_offset": offset + len(rows) if len(rows) == limit else None}


@router.post("/communities", status_code=201)
def create_community(data: CommunityCreate, current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    throttle(current.id, "community", 3, 3600)
    uploaded_image_or_none(data.avatar_url)
    uploaded_image_or_none(data.banner_url)
    if db.query(Community.id).filter(func.lower(Community.name) == data.name.strip().lower()).first():
        raise HTTPException(409, "A community with this name exists")
    conv = Conversation(type="GROUP", name=data.name.strip(), description=data.description.strip(),
        created_by_id=current.id)
    db.add(conv); db.flush()
    db.add(ConversationMember(conversation_id=conv.id, user_id=current.id, role="ADMIN"))
    community = Community(name=data.name.strip(), description=data.description.strip(),
        avatar_url=data.avatar_url, banner_url=data.banner_url,
        owner_id=current.id, conversation_id=conv.id)
    db.add(community); db.flush()
    db.add(CommunityMember(community_id=community.id, user_id=current.id, role="OWNER"))
    db.commit()
    return community_dict(db, community, current.id)


@router.get("/communities/{community_id}")
def get_community(community_id: int, current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return community_dict(db, community_or_404(db, community_id), current.id)


@router.patch("/communities/{community_id}")
def edit_community(community_id: int, data: CommunityEdit,
                   current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    uploaded_image_or_none(data.avatar_url)
    uploaded_image_or_none(data.banner_url)
    community = community_or_404(db, community_id)
    role = member(db, community_id, current.id)
    if not role or role.role not in ("OWNER", "MODERATOR"):
        raise HTTPException(403, "Moderator access required")
    community.name, community.description = data.name.strip(), data.description.strip()
    community.avatar_url, community.banner_url = data.avatar_url, data.banner_url
    db.commit()
    return community_dict(db, community, current.id)


@router.post("/communities/{community_id}/join")
async def join_community(community_id: int, current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    throttle(current.id, "community_join", 20)
    community = community_or_404(db, community_id)
    if UserService.is_blocked(db, current.id, community.owner_id):
        raise HTTPException(403, "Community unavailable")
    if not member(db, community_id, current.id):
        db.add(CommunityMember(community_id=community_id, user_id=current.id))
        db.add(ConversationMember(conversation_id=community.conversation_id, user_id=current.id, role="MEMBER"))
        db.commit()
        await notify(db, community.owner_id, current.id, "community_join", "community", community_id)
    return community_dict(db, community, current.id)


@router.delete("/communities/{community_id}/join")
def leave_community(community_id: int, current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    community = community_or_404(db, community_id)
    if community.owner_id == current.id:
        raise HTTPException(403, "Transfer ownership before leaving")
    db.query(CommunityMember).filter_by(community_id=community_id, user_id=current.id).delete()
    db.query(ConversationMember).filter_by(conversation_id=community.conversation_id, user_id=current.id).delete()
    db.commit()
    return community_dict(db, community, current.id)


@router.get("/communities/{community_id}/members")
def community_members(community_id: int, limit: int = Query(25, ge=1, le=50), offset: int = Query(0, ge=0),
                      current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    community_or_404(db, community_id)
    rows = db.query(CommunityMember).filter_by(community_id=community_id).order_by(
        CommunityMember.joined_at).offset(offset).limit(limit).all()
    return {"items": [{"user": db.get(User, row.user_id).to_dict(False), "role": row.role}
        for row in rows if not UserService.is_blocked(db, current.id, row.user_id)],
        "next_offset": offset + len(rows) if len(rows) == limit else None}


@router.patch("/communities/{community_id}/members/{user_id}")
def set_member_role(community_id: int, user_id: int, data: MemberRole,
                    current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    community = community_or_404(db, community_id)
    if community.owner_id != current.id:
        raise HTTPException(403, "Only the owner can manage roles")
    target = member(db, community_id, user_id)
    if not target or user_id == current.id:
        raise HTTPException(404, "Member not found")
    target.role = data.role
    chat_member = db.query(ConversationMember).filter_by(conversation_id=community.conversation_id, user_id=user_id).first()
    if chat_member:
        chat_member.role = "ADMIN" if data.role == "MODERATOR" else "MEMBER"
    db.commit()
    return {"role": target.role}


@router.delete("/communities/{community_id}/members/{user_id}")
def remove_community_member(community_id: int, user_id: int,
                            current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    community = community_or_404(db, community_id)
    actor = member(db, community_id, current.id)
    target = member(db, community_id, user_id)
    if not actor or actor.role not in ("OWNER", "MODERATOR") or not target or target.role == "OWNER" or (
        actor.role == "MODERATOR" and target.role == "MODERATOR"):
        raise HTTPException(403, "Cannot remove this member")
    db.delete(target)
    db.query(ConversationMember).filter_by(conversation_id=community.conversation_id, user_id=user_id).delete()
    db.commit()
    return {"removed": True}


@router.get("/communities/{community_id}/posts")
def community_posts(community_id: int, limit: int = Query(15, ge=1, le=30), offset: int = Query(0, ge=0),
                    current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    community_or_404(db, community_id)
    rows = FeedService.visible_query(db, current.id).filter(Post.community_id == community_id).order_by(
        Post.pinned.desc(), Post.created_at.desc()).offset(offset).limit(limit).all()
    return {"items": FeedService.serialize_many(db, rows, current.id),
        "next_offset": offset + len(rows) if len(rows) == limit else None}


@router.post("/communities/{community_id}/posts/{post_id}/pin")
def pin_community_post(community_id: int, post_id: int,
                       current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    role = member(db, community_id, current.id)
    if not role or role.role not in ("OWNER", "MODERATOR"):
        raise HTTPException(403, "Moderator access required")
    post = post_or_404(db, post_id, current.id)
    if post.community_id != community_id:
        raise HTTPException(404, "Post not found in community")
    post.pinned = True; db.commit()
    return FeedService.serialize(db, post, current.id)


@router.delete("/communities/{community_id}/posts/{post_id}/pin")
def unpin_community_post(community_id: int, post_id: int,
                         current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    role = member(db, community_id, current.id)
    if not role or role.role not in ("OWNER", "MODERATOR"):
        raise HTTPException(403, "Moderator access required")
    post = post_or_404(db, post_id, current.id)
    if post.community_id != community_id:
        raise HTTPException(404, "Post not found in community")
    post.pinned = False; db.commit()
    return FeedService.serialize(db, post, current.id)


@router.delete("/communities/{community_id}/posts/{post_id}")
def remove_community_post(community_id: int, post_id: int,
                          current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    role = member(db, community_id, current.id)
    if not role or role.role not in ("OWNER", "MODERATOR"):
        raise HTTPException(403, "Moderator access required")
    post = post_or_404(db, post_id, current.id)
    if post.community_id != community_id:
        raise HTTPException(404, "Post not found in community")
    post.deleted_at = datetime.now(timezone.utc); db.commit()
    return {"deleted": True}
