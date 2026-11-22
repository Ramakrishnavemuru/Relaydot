# Creator accounts and analytics

Users can enable Creator mode in **Settings → Account Type and Tools**. A private account must explicitly confirm the switch to public. Switching back to Personal preserves posts, followers, messages, and historical events. Creator profile contact details are shown only after the owner enables that option.

The owner opens **Professional Dashboard** from their profile. The dashboard offers Home, Performance, Content, and Audience tabs with 7, 30, 90, and custom day ranges. Content insights are also available to accepted collaborators on the shared post. All analytics endpoints enforce ownership or accepted collaboration on the server.

## Measurement

- A post view is recorded after at least half its card is visible for one second. It is counted once per signed-in viewer, post, and UTC day. Owners and accepted collaborators are excluded.
- Reel views use the existing qualified Reel view event, recorded after three seconds. Story views use the existing unique story viewer record.
- Profile visits are recorded once per signed-in visitor and creator per UTC day. Self visits are excluded.
- Accounts reached counts distinct signed-in content viewers across posts, Reels, and stories in the selected range. Total views counts qualified content views and can exceed reach.
- Follower gains and losses are recorded when follow or unfollow changes succeed. Post chat shares are recorded after message delivery. Existing timestamped likes, comments, saves, and Reel shares are counted from their source tables.
- Follower versus non-follower attribution is captured at view time. Older views without attribution are marked unknown. Engagement rate is `(likes + comments + shares + saves) / qualified views × 100` and may exceed 100%.
- The dashboard uses UTC calendar days. Earlier unrecorded post views, historical unfollows, and deleted reactions cannot be reconstructed and are never invented. Relaydot does not collect age, gender, or reliable follower active hours, so those charts remain unavailable.

## Scheduled posts

The dashboard's Scheduled Content tool stores a validated post payload and UTC publish time on the server. A worker in the FastAPI process claims due jobs, recovers interrupted claims, retries failures with backoff, and uses the existing post API's client idempotency key to avoid duplicate posts. Collaboration invitations are sent when the post is created. Scheduled media is uploaded when scheduling, so its storage must remain available until publication. Run at least one continuously running API process; scheduling cannot publish while all API processes are stopped.

## Schema and routes

Startup migrations add `users.account_type`, `creator_category`, `creator_contact_enabled`, `creator_enabled_at`, and audience attribution columns on Reel and Story views. New `creator_events` and `scheduled_posts` tables retain measured events and server schedules. Existing user and content records are preserved.

The authenticated `/api/creator` router provides account switching, profile configuration, view recording, summary, performance, content, individual insights, audience, monthly recap, account status, and scheduled post CRUD. Date ranges and content pagination are validated by the API.

Ad Tools, Monetisation, and Competitive Insights are labeled unavailable because Relaydot has no corresponding infrastructure or permissioned comparison data.

## Individual post and Reel insights

Owners of public accounts and accepted post collaborators can open **View insights** from their content or from Professional Dashboard → Content. The report has Overview, Engagement, and Audience tabs, with first 24 hours, last 7/30/90 days, and lifetime windows. The API is `GET /api/creator/insights/{POST|REEL}/{id}/detail?window=...`. It rejects other viewers and removed collaborators. One shared post keeps one canonical report.

New Reel playback is sent to `POST /api/reels/{public_id}/playback` from the existing video player. A session starts on actual play, sends bounded progress, pause, resume, completion, replay, and early exit events. The server accepts at most ten seconds per event and no more watch time than elapsed wall time plus tolerance; it ignores repeated sequence numbers for a session. A qualified view requires three seconds of recorded playback and is deduplicated by account and Reel over 24 hours. Reach is distinct accounts with a qualified view in the selected window. Watch time and average watch time use the new playback sessions only. An early exit means a closed session with less than the lesser of three seconds or 25% of video duration watched. Completion requires at least 80% watch time and a position at least 95% through the Reel. Playback starts are the denominator for skip and completion rates. The web player pauses tracking when hidden or buffering.

For posts, a qualified view is one second at 50% viewport visibility, deduplicated by account and post per UTC day. Owner and accepted collaborator views are excluded. Reel and post likes, comments, saves, shares, and reposts are current retained records created during the selected window. Share counts use delivered chat shares. Reel reposts are unavailable. `POST /api/social/profiles/{id}/follow?source_kind=POST|REEL&source_id=...` records a follow attributed to the source content only when a new follow is created and the source belongs to that account.

Like, comment, share, save, and post repost rates equal the respective retained count divided by qualified views × 100. Engagement rate uses the sum of those retained interactions divided by qualified views × 100. These rates can exceed 100% because chat shares and comments can repeat. No rate is shown without a recorded view. Audience follower status is captured when the view occurs. The follower/non-follower breakdown is hidden until ten distinct accounts are reached; unknown status remains unknown. Profile visits attributable to an individual item and demographics are unavailable. Historic watch time before this tracking was introduced and deleted interactions cannot be reconstructed. The legacy Reel view API remains readable for existing clients, but it cannot create a view from a client-supplied duration; only validated playback sessions can create new Reel views.

The additive `reel_playbacks` table is created on startup by the existing metadata setup. It stores a unique account/Reel/session tuple, bounded watch duration, state, qualification, completion, skip, replay count, and view-time audience classification. Existing Reel views and content records remain intact.
