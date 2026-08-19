# The crash prompt's primary button follows the app's accent

"Reopen them" was a hand-rolled `bg-blue-600`, the one control in the browser pane that ignored the
design system: it stayed blue whatever accent the user had chosen, and read as a different app's
button next to everything around it.

Both buttons in the prompt are now the shared `Button` component — `primary` for Reopen them, which
is neutral near-black (`--accent-bg`, gray-900) by default and takes the chosen accent when there is
one, and `secondary` for Discard. No behaviour changed; the restore action, its failure toast, and
the `iab-restore` hook are the same.
