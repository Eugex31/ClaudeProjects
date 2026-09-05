"use client";

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

// Starter set — review and edit freely, this is plain data, not pulled from
// any CMS or database.
const FAQS = [
  {
    question: "How does billing work?",
    answer:
      "You're billed monthly based on the plan you choose. You can upgrade, downgrade, or cancel at any time from your account's Billing page.",
  },
  {
    question: "Can I cancel anytime?",
    answer:
      "Yes. Cancel whenever you like from the Billing page — you'll keep access through the end of your current billing period, no questions asked.",
  },
  {
    question: "Do you integrate with my CRM?",
    answer:
      "Yes — connect Monday.com and we'll keep your contacts synced automatically. Support for more CRMs is on the roadmap.",
  },
  {
    question: "Is my data secure?",
    answer:
      "Your Gmail OAuth tokens and other sensitive data are encrypted at rest, and every account's contacts and campaigns are fully isolated from every other account.",
  },
  {
    question: "Do I need my own Gmail account to send campaigns?",
    answer:
      "Yes. Campaigns send through your own connected Gmail account, so your emails come from you — not a shared sending domain that recipients don't recognize.",
  },
  {
    question: "Can I import my existing contact list?",
    answer:
      "Yes, you can bulk-import contacts from a CSV file, with a step to map your file's columns to the right fields.",
  },
  {
    question: "What happens if I go over my plan's limits?",
    answer:
      "We'll let you know you're approaching your plan's contact, email, or template limits, and prompt you to upgrade — you won't be cut off mid-campaign without warning.",
  },
];

export function FaqSection() {
  return (
    <section id="faq" className="mx-auto max-w-3xl px-4 py-20">
      <div className="mx-auto mb-10 max-w-2xl text-center">
        <h2 className="text-3xl font-semibold tracking-tight">Frequently asked questions</h2>
      </div>
      <Accordion type="multiple">
        {FAQS.map((faq) => (
          <AccordionItem key={faq.question} value={faq.question}>
            <AccordionTrigger>{faq.question}</AccordionTrigger>
            <AccordionContent className="text-muted-foreground">{faq.answer}</AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  );
}
