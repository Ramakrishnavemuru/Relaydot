"""Small replaceable background video worker; all reel media stays outside public uploads."""
import asyncio
import json
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path
from fastapi import HTTPException
from app.config import settings
from app.database import SessionLocal
from app.models.reel import Reel, ReelMention
from app.websocket.manager import manager

log = logging.getLogger("reel_processor")
MEDIA_ROOT = Path(settings.UPLOAD_DIR).resolve().parent / "reel_media"
MEDIA_ROOT.mkdir(parents=True, exist_ok=True)


async def command(*args, timeout=240):
    process = await asyncio.create_subprocess_exec(*args, stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE)
    try:
        out, err = await asyncio.wait_for(process.communicate(), timeout)
    except asyncio.TimeoutError:
        process.kill()
        await process.communicate()
        raise ValueError("Video processing timed out")
    if process.returncode:
        raise ValueError("Invalid or unsupported video")
    return out


async def process_reel(reel_id: int):
    with SessionLocal() as db:
        claimed = db.query(Reel).filter_by(id=reel_id, status="PROCESSING").update({
            "status":"TRANSCODING", "processing_started_at":datetime.now(timezone.utc)},
            synchronize_session=False)
        db.commit()
        if not claimed:
            return
        reel = db.get(Reel, reel_id)
        source = MEDIA_ROOT / reel.public_id / "source"
        output = MEDIA_ROOT / reel.public_id / "video.mp4"
        thumb = MEDIA_ROOT / reel.public_id / "cover.jpg"
        try:
            raw = await command("ffprobe", "-v", "error", "-show_streams", "-show_format",
                "-of", "json", str(source), timeout=30)
            info = json.loads(raw)
            video = next((s for s in info.get("streams", []) if s.get("codec_type") == "video"), None)
            duration = float(info.get("format", {}).get("duration") or (video or {}).get("duration") or 0)
            width, height = int((video or {}).get("width") or 0), int((video or {}).get("height") or 0)
            if not video or not 1 <= duration <= 180 or not 1 <= width <= 3840 or not 1 <= height <= 3840:
                raise ValueError("Reels must be 1–180 seconds and at most 3840px in either dimension")
            ratio = min(1.0, 720 / width, 1280 / height)
            target_width = max(2, int(width * ratio) // 2 * 2)
            target_height = max(2, int(height * ratio) // 2 * 2)
            await command("ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
                "-i", str(source), "-map", "0:v:0", "-map", "0:a:0?",
                "-vf", f"scale={target_width}:{target_height}",
                "-r", "30", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
                "-maxrate", "2500k", "-bufsize", "5000k", "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-b:a", "128k", "-map_metadata", "-1",
                "-movflags", "+faststart", str(output))
            await command("ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
                "-ss", str(min(duration / 2, 2)), "-i", str(output), "-frames:v", "1",
                "-vf", "scale=360:-2", str(thumb), timeout=60)
            db.refresh(reel)
            if reel.deleted_at or reel.status == "REMOVED":
                output.unlink(missing_ok=True)
                thumb.unlink(missing_ok=True)
                return
            reel.duration, reel.width, reel.height = duration, width, height
            reel.video_path, reel.thumbnail_path = str(output), str(thumb)
            reel.status = "PUBLISHED" if reel.publish_requested else "READY"
            if reel.status == "PUBLISHED":
                reel.published_at = datetime.now(timezone.utc)
            reel.error = None
            db.commit()
            source.unlink(missing_ok=True)
        except Exception as error:
            log.warning("Reel %s processing failed: %s", reel_id, error)
            output.unlink(missing_ok=True)
            thumb.unlink(missing_ok=True)
            source.unlink(missing_ok=True)
            db.refresh(reel)
            if not reel.deleted_at and reel.status != "REMOVED":
                reel.status = "FAILED"
                reel.error = str(error)[:255]
                db.commit()
                try:
                    await manager.send_to_user(reel.creator_id, {"event":"reel.failed",
                        "data":{"public_id":reel.public_id,"error":reel.error}})
                except Exception:
                    log.exception("Could not notify creator of failed Reel %s", reel_id)
            return
        # Delivery failures must not undo a successfully published video.
        try:
            if reel.status == "PUBLISHED":
                from app.routes.social import notify
                from app.services.reel_service import get_visible
                for (user_id,) in db.query(ReelMention.user_id).filter_by(reel_id=reel.id):
                    try:
                        get_visible(db, reel.public_id, user_id)
                    except HTTPException:
                        continue
                    await notify(db, user_id, reel.creator_id, "reel_mention", "reel", reel.id)
            await manager.send_to_user(reel.creator_id, {"event":"reel.ready",
                "data":{"public_id":reel.public_id,"status":reel.status}})
        except Exception:
            log.exception("Could not notify creator or mentions for Reel %s", reel_id)


async def run_reel_worker():
    while True:
        try:
            with SessionLocal() as db:
                cutoff = datetime.now(timezone.utc) - timedelta(minutes=10)
                db.query(Reel).filter(Reel.status == "TRANSCODING",
                    Reel.processing_started_at < cutoff).update({"status":"PROCESSING",
                        "processing_started_at":None}, synchronize_session=False)
                db.commit()
                ids = [row[0] for row in db.query(Reel.id).filter(Reel.status == "PROCESSING")
                    .order_by(Reel.created_at).limit(4).all()]
            for reel_id in ids:
                await process_reel(reel_id)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("Reel worker tick failed")
        await asyncio.sleep(3)
