"use client";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type {
  Service,
  CommonAnswers,
  CampaignAnswers,
  SequenceAnswers,
  NewsletterAnswers,
  SocialAnswers,
  TemplateAnswers,
  Tag,
  ConnectedAccount,
} from "./types";

export type Answers = {
  common: CommonAnswers;
  campaign: CampaignAnswers;
  sequence: SequenceAnswers;
  newsletter: NewsletterAnswers;
  social: SocialAnswers;
  template: TemplateAnswers;
};

export function StepQuestions({
  screen,
  answers,
  setAnswers,
  tags,
  accounts,
  onNext,
  onBack,
  isFirst,
  isLast,
}: {
  screen: "common" | Service;
  answers: Answers;
  setAnswers: (updater: (prev: Answers) => Answers) => void;
  tags: Tag[];
  accounts: ConnectedAccount[];
  onNext: () => void;
  onBack: () => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  function update<K extends keyof Answers>(key: K, patch: Partial<Answers[K]>) {
    setAnswers((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }

  const canContinue = (() => {
    if (screen === "common") return answers.common.durationDays > 0 && Boolean(answers.common.startAt);
    if (screen === "campaign") return answers.campaign.cta.trim().length > 0;
    if (screen === "sequence") return answers.sequence.goal.trim().length > 0;
    if (screen === "social") return answers.social.socialAccountIds.length > 0;
    if (screen === "template") return answers.template.purpose.trim().length > 0;
    return true;
  })();

  return (
    <div className="flex flex-col gap-4">
      {screen === "common" && (
        <>
          <div className="flex flex-col gap-1.5">
            <Label>How long should this campaign run?</Label>
            <Select
              value={String(answers.common.durationDays)}
              onValueChange={(v) => update("common", { durationDays: Number(v) })}
            >
              <SelectTrigger className="sm:max-w-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">1 week</SelectItem>
                <SelectItem value="14">2 weeks</SelectItem>
                <SelectItem value="30">1 month</SelectItem>
                <SelectItem value="90">3 months</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="start-at">When should it start?</Label>
            <Input
              id="start-at"
              type="date"
              value={answers.common.startAt}
              onChange={(e) => update("common", { startAt: e.target.value })}
              className="sm:max-w-xs"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Who should this reach?</Label>
            <Select
              value={answers.common.tagId ?? "all"}
              onValueChange={(v) => update("common", { tagId: v === "all" ? null : v })}
            >
              <SelectTrigger className="sm:max-w-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All contacts</SelectItem>
                {tags.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </>
      )}

      {screen === "campaign" && (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cta">What&apos;s the single most important thing you want the reader to do?</Label>
            <Input
              id="cta"
              value={answers.campaign.cta}
              onChange={(e) => update("campaign", { cta: e.target.value })}
              placeholder="e.g. Book a free consultation"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="offer">Any specific offer or deadline? (optional)</Label>
            <Input
              id="offer"
              value={answers.campaign.offer}
              onChange={(e) => update("campaign", { offer: e.target.value })}
              placeholder="e.g. 20% off through Friday"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Tone</Label>
            <Select value={answers.campaign.tone} onValueChange={(v) => update("campaign", { tone: v as CampaignAnswers["tone"] })}>
              <SelectTrigger className="sm:max-w-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["Professional", "Friendly", "Urgent", "Playful"].map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </>
      )}

      {screen === "sequence" && (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="goal">What&apos;s the goal of this sequence?</Label>
            <Textarea
              id="goal"
              value={answers.sequence.goal}
              onChange={(e) => update("sequence", { goal: e.target.value })}
              placeholder="e.g. Nurture new leads who requested a demo"
              rows={3}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>How often should each email go out?</Label>
            <Select
              value={String(answers.sequence.cadenceDays)}
              onValueChange={(v) => update("sequence", { cadenceDays: Number(v) })}
            >
              <SelectTrigger className="sm:max-w-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="3">Twice a week</SelectItem>
                <SelectItem value="7">Weekly</SelectItem>
                <SelectItem value="14">Every 2 weeks</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </>
      )}

      {screen === "newsletter" && (
        <>
          <div className="flex flex-col gap-1.5">
            <Label>How often should it go out?</Label>
            <Select
              value={answers.newsletter.frequency}
              onValueChange={(v) => update("newsletter", { frequency: v as NewsletterAnswers["frequency"] })}
            >
              <SelectTrigger className="sm:max-w-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="WEEKLY">Weekly</SelectItem>
                <SelectItem value="MONTHLY">Monthly</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="coverage">What should each edition typically cover? (optional)</Label>
            <Textarea
              id="coverage"
              value={answers.newsletter.coverage}
              onChange={(e) => update("newsletter", { coverage: e.target.value })}
              rows={3}
            />
          </div>
        </>
      )}

      {screen === "social" && (
        <>
          <div className="flex flex-col gap-1.5">
            <Label>Which connected accounts should this post to?</Label>
            {accounts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No connected accounts yet — connect one on the{" "}
                <a href="/social" className="underline">
                  Social
                </a>{" "}
                page first.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {accounts.map((a) => {
                  const checked = answers.social.socialAccountIds.includes(a.id);
                  return (
                    <label key={a.id} className="flex items-center gap-3 rounded-md border p-2.5 text-sm">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() =>
                          update("social", {
                            socialAccountIds: checked
                              ? answers.social.socialAccountIds.filter((id) => id !== a.id)
                              : [...answers.social.socialAccountIds, a.id],
                          })
                        }
                      />
                      {a.displayName} ({a.platform === "FACEBOOK_PAGE" ? "Facebook" : "Instagram"})
                    </label>
                  );
                })}
              </div>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Posts per week</Label>
            <Select
              value={String(answers.social.postsPerWeek)}
              onValueChange={(v) => update("social", { postsPerWeek: Number(v) })}
            >
              <SelectTrigger className="sm:max-w-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1</SelectItem>
                <SelectItem value="2">2</SelectItem>
                <SelectItem value="3">3</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Tone</Label>
            <Select value={answers.social.tone} onValueChange={(v) => update("social", { tone: v as SocialAnswers["tone"] })}>
              <SelectTrigger className="sm:max-w-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["Professional", "Casual", "Promotional", "Behind-the-scenes"].map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </>
      )}

      {screen === "template" && (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="template-purpose">What&apos;s this template for?</Label>
            <Textarea
              id="template-purpose"
              value={answers.template.purpose}
              onChange={(e) => update("template", { purpose: e.target.value })}
              placeholder="e.g. A welcome email for new customers, reusable for every signup"
              rows={3}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Tone</Label>
            <Select value={answers.template.tone} onValueChange={(v) => update("template", { tone: v as TemplateAnswers["tone"] })}>
              <SelectTrigger className="sm:max-w-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["Professional", "Friendly", "Urgent", "Playful"].map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </>
      )}

      <div className="flex gap-2 pt-2">
        {!isFirst && (
          <Button type="button" variant="outline" onClick={onBack}>
            Back
          </Button>
        )}
        <Button type="button" onClick={onNext} disabled={!canContinue}>
          {isLast ? "Generate" : "Next"}
        </Button>
      </div>
    </div>
  );
}
