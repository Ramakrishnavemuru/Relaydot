import os
import uuid
import shutil
from pathlib import Path
from typing import Dict, Any
from fastapi import UploadFile
from app.config import settings

# Attempt to configure Cloudinary if credentials are provided
cloudinary_configured = False
if settings.CLOUDINARY_CLOUD_NAME and settings.CLOUDINARY_API_KEY and settings.CLOUDINARY_API_SECRET:
    try:
        import cloudinary
        import cloudinary.uploader
        cloudinary.config(
            cloud_name=settings.CLOUDINARY_CLOUD_NAME,
            api_key=settings.CLOUDINARY_API_KEY,
            api_secret=settings.CLOUDINARY_API_SECRET,
            secure=True
        )
        cloudinary_configured = True
    except Exception:
        cloudinary_configured = False


async def upload_file_service(file: UploadFile) -> Dict[str, Any]:
    """
    Upload a file either to Cloudinary (if configured) or to local storage (fallback).
    Returns dict with file_url, file_name, file_type, file_size, and public_id.
    """
    original_filename = file.filename or "uploaded_file"
    file_type = file.content_type or "application/octet-stream"
    
    # Read file content to get size and write
    content = await file.read()
    file_size = len(content)

    if cloudinary_configured:
        try:
            import cloudinary.uploader
            resource_type = "auto"
            if file_type.startswith("image/"):
                resource_type = "image"
            elif file_type.startswith("video/"):
                resource_type = "video"
            
            result = cloudinary.uploader.upload(
                content,
                resource_type=resource_type,
                folder="realtime_chat"
            )
            return {
                "file_url": result.get("secure_url"),
                "file_name": original_filename,
                "file_type": file_type,
                "file_size": file_size,
                "public_id": result.get("public_id")
            }
        except Exception as e:
            # Fall back to local if Cloudinary fails
            pass

    # Local fallback
    ext = original_filename.rsplit(".", 1)[-1] if "." in original_filename else ""
    unique_filename = f"{uuid.uuid4().hex}{('.' + ext) if ext else ''}"
    file_path = os.path.join(settings.UPLOAD_DIR, unique_filename)

    with open(file_path, "wb") as buffer:
        buffer.write(content)

    file_url = f"/uploads/{unique_filename}"
    return {
        "file_url": file_url,
        "file_name": original_filename,
        "file_type": file_type,
        "file_size": file_size,
        "public_id": unique_filename
    }
