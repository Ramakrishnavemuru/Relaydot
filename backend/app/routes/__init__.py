from fastapi import APIRouter
from app.routes.auth import router as auth_router
from app.routes.users import router as users_router
from app.routes.conversations import router as conversations_router
from app.routes.groups import router as groups_router
from app.routes.messages import router as messages_router
from app.routes.search import router as search_router
from app.routes.uploads import router as uploads_router

api_router = APIRouter(prefix="/api")

api_router.include_router(auth_router)
api_router.include_router(users_router)
api_router.include_router(conversations_router)
api_router.include_router(groups_router)
api_router.include_router(messages_router)
api_router.include_router(search_router)
api_router.include_router(uploads_router)
