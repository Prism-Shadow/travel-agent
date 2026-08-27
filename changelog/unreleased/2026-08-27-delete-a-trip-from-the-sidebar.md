# A trip can be deleted from the sidebar

The trip card's actions gain a delete button, between "new conversation in this trip" and the
link that opens it.

Details:

- Deleting asks first, through the same confirmation the conversation rows use. Cancelling
  changes nothing.
- The conversations of a deleted trip are deliberately not refetched: they keep the trip id they
  were loaded with, and the sidebar already files a conversation whose trip is absent under loose
  questions — which is where they now belong. Someone standing on the deleted trip's page is
  moved off it, since that page has nothing left to show.
- The confirmation's wording is corrected while it is being reused. It promised that "the trip
  folder on disk is not deleted", which stopped being true when a never-used trip started taking
  its untouched folder with it. It now says what actually happens: the folder is kept if the
  journey put anything in it, and an empty one goes with the trip.
