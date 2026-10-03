from fastapi import APIRouter, Depends, UploadFile, File, HTTPException, status
from app.models.user import User
from app.services.cloudinary_service import upload_file_service
from app.utils.validators import validate_file
from app.security.dependencies import get_current_user
from app.services.rate_limit import throttle
from app.config import settings

router = APIRouter(prefix="/uploads", tags=["Uploads"])


@router.post("")
async def upload_file(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user)
):
    """Upload an image or document (Cloudinary or local storage fallback)."""
    # Quick sanity check on filename
    if not file.filename:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No file uploaded.")

    throttle(current_user.id, "upload", 20)
    if file.filename.rsplit(".", 1)[-1].lower() == "svg":
        raise HTTPException(400, "SVG uploads are not supported.")
    validate_file(file.filename, 0)
    sample = await file.read(settings.MAX_FILE_SIZE_MB * 1024 * 1024 + 1)
    validate_file(file.filename, len(sample))
    extension = file.filename.rsplit(".", 1)[-1].lower()
    signatures = {"png":sample.startswith(b"\x89PNG\r\n\x1a\n"),
        "jpg":sample.startswith(b"\xff\xd8\xff"), "jpeg":sample.startswith(b"\xff\xd8\xff"),
        "gif":sample.startswith((b"GIF87a",b"GIF89a")),
        "webp":sample.startswith(b"RIFF") and sample[8:12] == b"WEBP",
        "mp4":sample[4:8] == b"ftyp", "pdf":sample.startswith(b"%PDF-")}
    if extension in signatures and not signatures[extension]:
        raise HTTPException(400, "File contents do not match its extension.")
    await file.seek(0)
    result = await upload_file_service(file)
    return result
