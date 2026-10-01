import os
from typing import List, Dict, Any


class CallService:
    @staticmethod
    def get_ice_servers() -> List[Dict[str, Any]]:
        """
        Returns WebRTC ICE servers (STUN / TURN).
        Defaults to reliable free public Google STUN servers.
        Can be augmented with custom TURN credentials via environment variables.
        """
        servers = [
            {"urls": "stun:stun.l.google.com:19302"},
            {"urls": "stun:stun1.l.google.com:19302"},
            {"urls": "stun:stun2.l.google.com:19302"},
            {"urls": "stun:stun3.l.google.com:19302"},
            {"urls": "stun:stun4.l.google.com:19302"},
        ]

        turn_url = "turns:global.relay.metered.ca:443?transport=tcp"
        turn_username = "6faf161da06f97642e4ab92a"
        turn_credential = "9BwCLR9Brt5j+/t8"

        if turn_url:
            turn_config: Dict[str, Any] = {"urls": turn_url}
            if turn_username and turn_credential:
                turn_config["username"] = turn_username
                turn_config["credential"] = turn_credential
            servers.append(turn_config)

        return servers
