"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Workflow, FileText, Tags, BarChart3, Plug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const SLIDES = [
  {
    icon: Workflow,
    headline: "Automation Sequences",
    description: "Build multi-step email sequences that enroll contacts automatically on signup, tag, or a date field like an appointment.",
  },
  {
    icon: FileText,
    headline: "Template Library",
    description: "Browse a growing library of starter templates by category, or save and reuse your own — never write the same email twice.",
  },
  {
    icon: Tags,
    headline: "Segmentation",
    description: "Tag your contacts and target campaigns, sequences, and newsletters to exactly the segment you mean to reach.",
  },
  {
    icon: BarChart3,
    headline: "Performance Reporting",
    description: "Open and click tracking on every campaign, with a reporting dashboard that shows what's actually working.",
  },
  {
    icon: Plug,
    headline: "CRM Integration",
    description: "Keep your CRM in sync automatically — connect once and every contact stays up to date without manual exports.",
  },
];

const AUTO_ROTATE_MS = 6000;

export function HeroCarousel() {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const timer = setInterval(() => {
      setIndex((i) => (i + 1) % SLIDES.length);
    }, AUTO_ROTATE_MS);
    return () => clearInterval(timer);
  }, [paused]);

  function goTo(next: number) {
    setIndex((next + SLIDES.length) % SLIDES.length);
  }

  const slide = SLIDES[index];
  const Icon = slide.icon;

  return (
    <div
      className="relative mx-auto flex max-w-3xl flex-col items-center gap-6 rounded-2xl border bg-card/50 px-6 py-12 text-center"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="flex size-16 items-center justify-center rounded-full bg-primary/10">
        <Icon className="size-8 text-primary" />
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="text-2xl font-semibold tracking-tight">{slide.headline}</h3>
        <p className="max-w-xl text-muted-foreground">{slide.description}</p>
      </div>

      <div className="flex items-center gap-4">
        <Button type="button" variant="outline" size="icon" onClick={() => goTo(index - 1)} aria-label="Previous slide">
          <ChevronLeft className="size-4" />
        </Button>
        <div className="flex items-center gap-2">
          {SLIDES.map((s, i) => (
            <button
              key={s.headline}
              type="button"
              aria-label={`Go to slide ${i + 1}`}
              onClick={() => goTo(i)}
              className={cn(
                "size-2 rounded-full transition-colors",
                i === index ? "bg-primary" : "bg-muted-foreground/30"
              )}
            />
          ))}
        </div>
        <Button type="button" variant="outline" size="icon" onClick={() => goTo(index + 1)} aria-label="Next slide">
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}
