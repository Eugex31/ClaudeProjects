"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Mail, Workflow, Newspaper, Share2, FileText } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { StepQuestions, type Answers } from "./step-questions";
import { StepReview } from "./step-review";
import type { Service, Tag, ConnectedAccount, GeneratedResult } from "./types";

const SERVICE_INFO: Record<Service, { label: string; description: string; icon: React.ComponentType<{ className?: string }> }> = {
  campaign: { label: "Email Campaign", description: "A one-off marketing email.", icon: Mail },
  sequence: { label: "Sequence", description: "A multi-step automated email series.", icon: Workflow },
  newsletter: { label: "Newsletter", description: "A recurring email on a schedule.", icon: Newspaper },
  social: { label: "Social Media Posts", description: "Posts to your connected Facebook/Instagram accounts.", icon: Share2 },
  template: { label: "Email Template", description: "A reusable template saved to your Template Library.", icon: FileText },
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

const DEFAULT_ANSWERS: Answers = {
  common: { durationDays: 30, startAt: todayIso(), tagId: null },
  campaign: { cta: "", offer: "", tone: "Professional" },
  sequence: { goal: "", cadenceDays: 7 },
  newsletter: { frequency: "WEEKLY", coverage: "" },
  social: { socialAccountIds: [], postsPerWeek: 2, tone: "Professional" },
  template: { purpose: "", tone: "Professional" },
};

type Stage = "intent" | "questions" | "generating" | "review" | "done";

export function CampaignWizard() {
  const [stage, setStage] = useState<Stage>("intent");
  const [intent, setIntent] = useState("");
  const [services, setServices] = useState<Set<Service>>(new Set());
  const [tags, setTags] = useState<Tag[]>([]);
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [answers, setAnswers] = useState<Answers>(DEFAULT_ANSWERS);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [generated, setGenerated] = useState<GeneratedResult | null>(null);
  const [doneLinks, setDoneLinks] = useState<{ label: string; href: string }[]>([]);

  useEffect(() => {
    fetch("/api/tags")
      .then((r) => r.json())
      .then((d) => setTags(d.tags ?? []));
    fetch("/api/social/meta")
      .then((r) => r.json())
      .then((d) => setAccounts(d.accounts ?? []));
  }, []);

  function toggleService(s: Service) {
    setServices((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }

  const questionScreens: ("common" | Service)[] = ["common", ...(["campaign", "sequence", "newsletter", "social", "template"] as Service[]).filter((s) => services.has(s))];

  async function generate() {
    setStage("generating");
    const body: Record<string, unknown> = {
      intent,
      services: Array.from(services),
      common: answers.common,
    };
    if (services.has("campaign")) body.campaign = answers.campaign;
    if (services.has("sequence")) body.sequence = answers.sequence;
    if (services.has("newsletter")) body.newsletter = answers.newsletter;
    if (services.has("social")) body.social = answers.social;
    if (services.has("template")) body.template = answers.template;

    const res = await fetch("/api/campaign-wizard/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error ?? "Generation failed");
      setStage("questions");
      return;
    }
    setGenerated(data);
    setStage("review");
  }

  if (stage === "intent") {
    return (
      <Card>
        <CardContent className="flex flex-col gap-6 pt-6">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Describe your campaign</label>
            <Textarea
              value={intent}
              onChange={(e) => setIntent(e.target.value)}
              placeholder="e.g. Promote our fall sale to re-engage customers who haven't ordered in 3 months"
              rows={4}
            />
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">What should this use?</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {(Object.keys(SERVICE_INFO) as Service[]).map((s) => {
                const info = SERVICE_INFO[s];
                const Icon = info.icon;
                return (
                  <label key={s} className="flex items-start gap-3 rounded-md border p-3">
                    <Checkbox checked={services.has(s)} onCheckedChange={() => toggleService(s)} />
                    <div className="flex flex-col gap-0.5">
                      <span className="flex items-center gap-1.5 text-sm font-medium">
                        <Icon className="size-3.5" />
                        {info.label}
                      </span>
                      <span className="text-xs text-muted-foreground">{info.description}</span>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
          <Button
            className="self-start"
            disabled={!intent.trim() || services.size === 0}
            onClick={() => {
              setQuestionIndex(0);
              setStage("questions");
            }}
          >
            Continue
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (stage === "questions") {
    const screen = questionScreens[questionIndex];
    return (
      <Card>
        <CardContent className="pt-6">
          <StepQuestions
            screen={screen}
            answers={answers}
            setAnswers={setAnswers}
            tags={tags}
            accounts={accounts}
            isFirst={questionIndex === 0}
            isLast={questionIndex === questionScreens.length - 1}
            onBack={() => setQuestionIndex((i) => Math.max(0, i - 1))}
            onNext={() => {
              if (questionIndex === questionScreens.length - 1) generate();
              else setQuestionIndex((i) => i + 1);
            }}
          />
        </CardContent>
      </Card>
    );
  }

  if (stage === "generating") {
    return (
      <Card>
        <CardContent className="flex flex-col gap-3 pt-6">
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-24 w-full" />
          <p className="text-sm text-muted-foreground">Generating your campaign…</p>
        </CardContent>
      </Card>
    );
  }

  if (stage === "review" && generated) {
    return (
      <StepReview
        generated={generated}
        answers={answers}
        accounts={accounts}
        onDone={(links) => {
          setDoneLinks(links);
          setStage("done");
        }}
      />
    );
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-6">
        <p className="font-medium">Campaign created</p>
        <div className="flex flex-col gap-2">
          {doneLinks.map((l) => (
            <Link key={l.href} href={l.href} className="text-sm underline">
              {l.label}
            </Link>
          ))}
        </div>
        <Button
          variant="outline"
          className="self-start"
          onClick={() => {
            setStage("intent");
            setIntent("");
            setServices(new Set());
            setAnswers(DEFAULT_ANSWERS);
            setGenerated(null);
          }}
        >
          Start another campaign
        </Button>
      </CardContent>
    </Card>
  );
}
