# Research addendum: how Mindtrip structures chat × trip

`docs/research/mindtrip.md` gains §12, answering the one question the earlier snapshot left open —
the chat↔trip information architecture — as direct input to the "default project vs default trip"
design discussion.

- Sources: the full App Store release-note history (v1.1→v18.1) and first-hand screenshots of the
  web app taken with our own account.
- Findings recorded: trip : chat is 1 : N (a trip hub lists its own named chats); floating chats
  exist without any trip, so there is no "default trip" — only chats that are not yet trips; a
  trip is materialized by an explicit form (destination + optional dates + free-text preferences);
  trip constraint chips ride every chat inside the trip; bookings and receipts live at the trip
  layer; and the product inverted its containment in v9.0 (2025-12) from chat-first to
  trip-as-hub.
- Written in English per the repository language rule for additions to legacy Chinese documents.
