# The AI Lobby - Website

A locally-hosted static website for documenting the shenanigans of the AI Lobby creative studio.

## Quick Start

### Option 1: Just Open It
Simply double-click `index.html` to open it in your browser. This works for basic viewing, but some browsers may have restrictions on local file access.

### Option 2: Python Server (Recommended)
If you have Python installed, run one of these commands from this folder:

```bash
# Python 3
python -m http.server 8000

# Python 2 (if that's what you have)
python -m SimpleHTTPServer 8000
```

Then open your browser to: `http://localhost:8000`

### Option 3: VS Code Live Server
If you use VS Code, install the "Live Server" extension and click "Go Live" in the bottom right corner.

### Option 4: Node.js
If you have Node.js installed:

```bash
npx serve
```

## Project Structure

```
ai-lobby-site/
├── index.html          # Homepage with Stapler Threat Level
├── characters.html     # Personnel files (humans & AI entities)
├── incidents.html      # Incident log and documentation
├── lore.html          # Official policies and glossary
├── css/
│   └── styles.css     # All the styling (corporate-chaos aesthetic)
├── js/                # Empty - for future JavaScript if needed
├── images/            # Empty - add character portraits, logos, etc.
├── incidents/         # Empty - for individual incident detail pages
└── README.md          # You are here
```

## How to Edit

### Adding Content
All pages are plain HTML files. Open them in any text editor (VS Code, Notepad++, even regular Notepad) and edit directly.

### Changing the Stapler Threat Level
Find this section in any page:

```html
<div class="threat-status">
  <span class="threat-dot elevated"></span>
  <span class="threat-text elevated">ELEVATED</span>
</div>
```

Change `elevated` to one of:
- `low` (green)
- `moderate` (yellow)
- `elevated` (orange)
- `high` (red)
- `critical` (purple)

Also update the description text below it!

### Adding a New Character
In `characters.html`, copy an existing character card block and modify:

```html
<div class="character-card">
  <div class="character-header">
    <h3 class="character-name">NEW CHARACTER NAME</h3>
    <span class="character-title">Their Title / Role</span>
  </div>
  <div class="character-body">
    <p style="margin-bottom: 1rem;">
      Description goes here...
    </p>
    <div class="character-stat">
      <span class="stat-label">Stat Name</span>
      <span class="stat-value">Stat Value</span>
    </div>
    <!-- Add more stats as needed -->
  </div>
</div>
```

### Adding a New Incident
In `incidents.html`, copy an existing incident block and modify:

```html
<div class="incident-detail" id="YOUR-ID-HERE">
  <div class="incident-detail-header">
    <div>
      <div class="incident-detail-id">YOUR-ID-HERE</div>
      <h3 class="incident-detail-title">Incident Title</h3>
    </div>
    <div class="incident-meta">
      <span class="card-badge badge-ongoing">ONGOING</span>
      <!-- or badge-resolved -->
      <span class="text-muted">Priority: HIGH</span>
    </div>
  </div>
  <div class="incident-detail-body">
    <!-- Add sections for Summary, Timeline, Personnel, Resolution -->
  </div>
</div>
```

### Changing Colors
All colors are defined as CSS variables at the top of `css/styles.css`:

```css
:root {
  --lobby-highlight: #e94560;  /* Main accent color */
  --glitter-gold: #ffd700;     /* Kevin's sparkle */
  --stability-green: #2ecc71;   /* Good status */
  /* etc... */
}
```

Change these to adjust the entire site's color scheme.

## Available CSS Classes

### Badges
- `.badge-human` - Green badge for human staff
- `.badge-ai` - Purple badge for AI entities
- `.badge-incident` - Orange badge for incidents
- `.badge-resolved` - Green badge for resolved status
- `.badge-ongoing` - Red badge for ongoing status

### Special Effects
- `.redacted` - Creates a black bar that reveals text on hover
- `.glitter-warning` - Shimmering gold/purple gradient (for Kevin-related content)
- `.memo` - Official document styling with stamp

### Utility Classes
- `.text-center` - Center text
- `.text-muted` - Grayed out text
- `.mt-lg` / `.mb-lg` - Top/bottom margin

## Tips

1. **Keep it simple** - This is a static site, no build process needed
2. **Test changes** - Refresh your browser after editing
3. **Backup** - Copy the folder before major changes
4. **Images** - Add images to the `images/` folder and reference them with `images/filename.jpg`

## Future Enhancements (If You Want)

- Add character portrait images
- Create individual pages for each incident
- Add JavaScript for interactive threat level updates
- Add a "Submit Incident Report" form (would need a backend)
- Dark/light mode toggle (though it's already pretty dark)

---

*Documentation maintained by the AI Lobby Documentation Department*
*Last updated: Whenever someone remembers*
