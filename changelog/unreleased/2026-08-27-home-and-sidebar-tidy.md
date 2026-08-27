# The home screen stops introducing itself, and drafts leave the Trips list

Three things the consumer surface was saying twice, or saying in the wrong place.

Details:

- The draft screen's brand bar is gone — the penguin logo, a second "Travel Agent" heading, and
  the build version. The sidebar already names the application, and a version number belongs to
  the developer console rather than above a traveller's first sentence. `VersionLine` had no
  other caller and is deleted with it; the version stays reachable from the user menu, which is
  also where an available update is announced.
- Unsent drafts move out of the Trips list into a section of their own above it. A draft belongs
  to no journey yet — that is what makes it a draft — so listing it under a heading that reads
  TRIPS said something untrue about it.
- A trip with no conversations says so once, in the count beside its name. The extra "no
  conversations yet" line underneath repeated what the `0` already said.
