import Link from "next/link";

// lucide-react dropped brand-logo icons a while back, so these are small
// hand-drawn outline glyphs matching the rest of the icon set's stroke style
// — not a copy of any brand asset file.
function YoutubeIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="2" y="5" width="20" height="14" rx="4" />
      <path d="M10 9.5v5l4.5-2.5z" fill="currentColor" stroke="none" />
    </svg>
  );
}

function InstagramIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

// Placeholder URLs — swap in the real profile links whenever you have them.
const SOCIAL_LINKS = [
  { label: "YouTube", href: "#", icon: YoutubeIcon },
  { label: "Instagram", href: "#", icon: InstagramIcon },
];

const QUICK_LINKS = [
  { href: "#products", label: "Products" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
  { href: "#contact", label: "Contact" },
];

export function MarketingFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-4 py-10 sm:flex-row sm:justify-between">
        <p className="text-sm text-muted-foreground">© {year} LyneSign. All rights reserved.</p>

        <nav className="flex items-center gap-5">
          {QUICK_LINKS.map((link) => (
            <a key={link.href} href={link.href} className="text-sm text-muted-foreground hover:text-foreground">
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-4">
          {SOCIAL_LINKS.map((social) => (
            <Link
              key={social.label}
              href={social.href}
              aria-label={social.label}
              className="text-muted-foreground hover:text-foreground"
            >
              <social.icon className="size-5" />
            </Link>
          ))}
        </div>
      </div>
    </footer>
  );
}
