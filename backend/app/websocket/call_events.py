"""Call signaling WebSocket event types."""

EVENT_CALL_INVITE = "call_invite"
EVENT_CALL_ACCEPT = "call_accept"
EVENT_CALL_REJECT = "call_reject"
EVENT_WEBRTC_OFFER = "webrtc_offer"
EVENT_WEBRTC_ANSWER = "webrtc_answer"
EVENT_ICE_CANDIDATE = "ice_candidate"
EVENT_CALL_END = "call_end"

ALL_CALL_EVENTS = {
    EVENT_CALL_INVITE,
    EVENT_CALL_ACCEPT,
    EVENT_CALL_REJECT,
    EVENT_WEBRTC_OFFER,
    EVENT_WEBRTC_ANSWER,
    EVENT_ICE_CANDIDATE,
    EVENT_CALL_END
}
