from fastapi import APIRouter, Depends, UploadFile, File, HTTPException, status
from app.models.user import User
from app.services.cloudinary_service import upload_file_service
from app.utils.validators import validate_file
from app.security.dependencies import get_current_user

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

    # We validate after reading or via headers
    result = await upload_file_service(file)
    validate_file(result["file_name"], result["file_size"])
    return result
