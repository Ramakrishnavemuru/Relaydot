# Reel management

Creator accounts manage their own Reels from **Manage Reel** in the Reel player. The same published Reel appears in its Reels tab and, when enabled, its main profile grid. The owner can open archived Reels from the profile's **Archive** tab or the Reels page's **Archive** filter.

## Data and permissions

The existing `reels` table has additive columns for main grid visibility, pin time, partnership disclosure, and cover crop/zoom. The existing `posts` table gains a separate profile pin time; its earlier `pinned` flag remains reserved for community posts. The startup migration in `backend/app/main.py` adds these with backward compatible defaults for SQLite or PostgreSQL. Existing Reel columns hold archive state, count visibility, commenting, and download permission. No table is reset.

All management writes use the existing authenticated owner routes: `PATCH /api/reels/{public_id}`, `POST /api/reels/{public_id}/cover`, `POST /api/reels/{public_id}/cover-upload`, and `DELETE /api/reels/{public_id}`. Creator-only grid, pin, partnership, and crop settings are checked on the server. The original owner remains the only editor/deleter; accepted collaborators receive no owner permissions for Reels. Personal accounts retain their existing basic Reel controls.

`GET /api/reels?mode=archive` returns only the signed-in owner's archive. `GET /api/reels?creator_id={id}&placement=main` returns visible, published Reels selected for the profile grid. Public lists and direct Reel links exclude archived and removed Reels. Signed media URLs are bound to the authenticated viewer, and the official `/media/download` action checks the Reel's download setting. A playable video can still be copied or screen recorded outside Relaydot.

## Menu behavior

- **Archive / Restore:** Changes the existing status while preserving media, engagement, and insights. Archiving clears the pin. Archived Reels can be edited and have their cover adjusted by the owner.
- **Like and share count:** Hides public numbers independently per Reel; interactions and owner insights continue to use real counts.
- **Commenting:** The composer is disabled and the API rejects new comments while off; earlier comments remain.
- **Downloading:** Controls Relaydot's official download link and endpoint, including revoking a previously issued link. It cannot prevent copying playback media.
- **Edit:** Updates caption (including hashtags and mentions), location, and audience without changing the Reel ID or video.
- **Adjust preview:** Extracts a video frame or accepts a validated image cover, then saves crop position and zoom for the profile grid. The source video is unchanged.
- **View Insights:** Opens the existing Reel Insights route for this Reel, including its archived owner view. Metrics come from recorded activity.
- **Partnership label and ads:** Supports a creator supplied paid partnership disclosure and optional partner name. The name is not verified by Relaydot. No ad campaign is created.
- **Main grid and pin:** Main grid visibility is independent of Reel publication. Pinning adds the Reel to the main grid and places it first. Up to three profile items, counting original Posts and published Reels together, can be pinned per creator. The Reels tab remains available when the main grid is off. A creator can pin an original Post from its detail page via `POST /api/social/posts/{id}/profile-pin` and unpin with `DELETE` on the same route.
- **Delete:** Requires confirmation, sets the existing `REMOVED`/`deleted_at` state, removes the Reel from public views, and deletes its stored video and cover files. It cannot be restored. The database retains the Reel and related engagement rows for referential integrity and the existing analytics retention behavior.

**Suggested products** remains unavailable because this project has no product catalog. **Reuse in Relaydot** remains unavailable because there is no remix or reuse flow to control. Advertising beyond the disclosure label is unavailable. These options are visibly disabled rather than presented as working features.

The menu supports keyboard focus, Escape, backdrop dismissal, a mobile swipe handle, loading feedback, and in-app confirmations. Settings are saved per Reel and query caches refresh after a change.
