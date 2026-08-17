# The browser address bar opens the first tab

Opening the in-app Browser for a conversation with no tabs no longer leaves the address field
unusable. The field now accepts a URL immediately and creates the conversation's first tab when the
user presses Enter; existing tabs continue to navigate in place.

The field remains disabled only while Desktop is still confirming a conversation switch. This keeps
the existing session-isolation guarantee: a fast submission cannot create a tab in the conversation
the user just left.
