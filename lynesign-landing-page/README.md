# LyneSign Landing Page

Self-contained landing page for LyneSign, an indoor digital billboard advertising network in Houston, TX. Built as a single HTML file (all CSS/JS/images inline, only Google Fonts loaded externally) so it can be hosted anywhere with no build step.

- `index.html` — the landing page. Live at [lynesign.com/landing](https://lynesign.com/landing/).
- `instagram/houston-post.html` — source for a matching Instagram post creative.
- `instagram/houston-post.png` — the rendered 1080×1080 Instagram post, ready to upload.

## Lead form

The "Get Started" form on the landing page posts to a Google Apps Script Web App, which appends each submission to a Google Sheet and emails a notification. The endpoint URL is set in `index.html` inside the `<script>` block (`LEAD_ENDPOINT`) and on the form's `action` attribute.
