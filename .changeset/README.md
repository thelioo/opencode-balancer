# Changesets

Run `npm run changeset` when a change should be released. Commit the generated `.changeset/*.md` file with the code change.

After changes land on `main`, CI opens a version PR. Merging that PR publishes npm, pushes the matching `vX.Y.Z` tag, and creates a GitHub Release.
