"""Private media for posts. URLs are opaque; every read checks current visibility."""
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models.post_media import PostMedia
from app.models.social import Post, PostCollaborator
from app.models.user import User
from app.security.dependencies import get_current_user
from app.services.feed_service import FeedService
from app.services.rate_limit import throttle
from app.services.user_service import UserService

router = APIRouter(prefix="/social/post-media", tags=["Post media"])
POST_MEDIA_DIR = Path(settings.POST_MEDIA_DIR).resolve()
try:
    POST_MEDIA_DIR.relative_to(Path(settings.UPLOAD_DIR).resolve())
except ValueError:
    pass
else:
    raise RuntimeError("POST_MEDIA_DIR must be outside the public UPLOAD_DIR")

FORMATS = {
    "png": ("image/png", "IMAGE"), "jpg": ("image/jpeg", "IMAGE"),
    "jpeg": ("image/jpeg", "IMAGE"), "webp": ("image/webp", "IMAGE"),
    "gif": ("image/gif", "GIF"), "mp4": ("video/mp4", "VIDEO"),
    "webm": ("video/webm", "VIDEO"),
}


def media_id(url: str | None) -> str | None:
    prefix = "/api/social/post-media/"
    suffix = url[len(prefix):] if url and url.startswith(prefix) else ""
    return suffix if len(suffix) == 32 and all(c in "0123456789abcdef" for c in suffix) else None


def validate_reference(db: Session, owner_id: int, url: str, media_type: str) -> PostMedia | None:
    ident = media_id(url)
    if not ident:
        return None
    item = db.get(PostMedia, ident)
    if not item or item.owner_id != owner_id or item.media_type != media_type or item.post_id is not None:
        raise HTTPException(404, "Post media not found")
    return item


@router.post("", status_code=201)
async def upload_post_media(file: UploadFile = File(...), current: User = Depends(get_current_user),
                            db: Session = Depends(get_db)):
    throttle(current.id, "upload", 20)
    name = Path(file.filename or "").name
    if not name or len(name) > 255 or any(ord(char) < 32 for char in name):
        raise HTTPException(400, "Invalid file name")
    extension = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if extension not in FORMATS:
        raise HTTPException(400, "Choose a PNG, JPEG, WebP, GIF, MP4, or WebM file")
    content_type, media_type = FORMATS[extension]
    sample = await file.read(15 * 1024 * 1024 + 1)
    if not sample or len(sample) > 15 * 1024 * 1024:
        raise HTTPException(413, "Post media must be 15 MB or smaller")
    valid = {
        "png": sample.startswith(b"\x89PNG\r\n\x1a\n"),
        "jpg": sample.startswith(b"\xff\xd8\xff"), "jpeg": sample.startswith(b"\xff\xd8\xff"),
        "webp": sample.startswith(b"RIFF") and sample[8:12] == b"WEBP",
        "gif": sample.startswith((b"GIF87a", b"GIF89a")),
        "mp4": sample[4:8] == b"ftyp", "webm": sample.startswith(b"\x1a\x45\xdf\xa3"),
    }[extension]
    if not valid:
        raise HTTPException(400, "File contents do not match its extension")
    POST_MEDIA_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
    stored_name = uuid4().hex
    path = POST_MEDIA_DIR / stored_name
    try:
        path.write_bytes(sample)
        path.chmod(0o600)
        item = PostMedia(owner_id=current.id, stored_name=stored_name, file_name=name,
                         content_type=content_type, media_type=media_type, file_size=len(sample))
        db.add(item)
        db.commit()
        db.refresh(item)
    except Exception:
        path.unlink(missing_ok=True)
        db.rollback()
        raise
    return {"file_url": f"/api/social/post-media/{item.id}", "file_name": name,
            "file_type": content_type, "file_size": len(sample)}


@router.get("/{ident}")
def get_post_media(ident: str, current: User = Depends(get_current_user),
                   db: Session = Depends(get_db)):
    item = db.get(PostMedia, ident) if len(ident) == 32 else None
    if not item:
        raise HTTPException(404, "Media not found")
    if item.post_id is None:
        allowed = item.owner_id == current.id
    else:
        post = db.get(Post, item.post_id)
        allowed = bool(post and FeedService.can_view(db, post, current.id))
        if not allowed and post and not post.deleted_at and not UserService.is_blocked(db, current.id, post.author_id):
            allowed = db.query(PostCollaborator.id).filter_by(
                post_id=post.id, user_id=current.id, status="PENDING").first() is not None
    if not allowed:
        raise HTTPException(404, "Media not found")
    path = POST_MEDIA_DIR / item.stored_name
    if not path.is_file():
        raise HTTPException(404, "Media not found")
    return FileResponse(path, media_type=item.content_type, filename=item.file_name,
                        content_disposition_type="inline",
                        headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"})
