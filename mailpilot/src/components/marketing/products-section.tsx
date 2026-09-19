import { Workflow, FileText, Mail, Tags, BarChart3, Plug, Sparkles, Share2 } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const PRODUCTS = [
  {
    icon: Sparkles,
    title: "AI Content Generation",
    description: "Connect your own OpenAI or Anthropic key and generate email copy, captions, and images from a prompt — reviewed by you before anything sends.",
  },
  {
    icon: Share2,
    title: "Social Media Manager",
    description: "Connect Facebook and Instagram, compose posts with AI-generated captions and images, and schedule them to publish automatically.",
  },
  {
    icon: Workflow,
    title: "Automation Sequences",
    description: "Multi-step nurture sequences triggered by signup, a tag, or a date field — set it up once and let it run.",
  },
  {
    icon: FileText,
    title: "Template Library",
    description: "A growing library of starter templates by category, plus your own saved templates, ready to drop into any campaign.",
  },
  {
    icon: Mail,
    title: "Newsletters",
    description: "Recurring sends on a weekly or monthly schedule, built from a template and targeted to a segment automatically.",
  },
  {
    icon: Tags,
    title: "Segmentation",
    description: "Tag your contacts and target campaigns, sequences, and newsletters to exactly the audience you mean to reach.",
  },
  {
    icon: BarChart3,
    title: "Performance Reporting",
    description: "Open and click tracking on every send, rolled up into a reporting dashboard so you know what's working.",
  },
  {
    icon: Plug,
    title: "CRM Integration",
    description: "Connect your CRM once and keep contact data in sync automatically, no manual exports required.",
  },
];

export function ProductsSection() {
  return (
    <section id="products" className="mx-auto max-w-6xl px-4 py-20">
      <div className="mx-auto mb-12 max-w-2xl text-center">
        <h2 className="text-3xl font-semibold tracking-tight">One platform for AI-powered marketing</h2>
        <p className="mt-3 text-muted-foreground">
          Build, generate, send, post, and track — email and social, from a single cold email to a full lifecycle sequence.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {PRODUCTS.map((product) => (
          <Card key={product.title}>
            <CardHeader>
              <div className="mb-2 flex size-10 items-center justify-center rounded-md bg-primary/10">
                <product.icon className="size-5 text-primary" />
              </div>
              <CardTitle>{product.title}</CardTitle>
              <CardDescription>{product.description}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>
    </section>
  );
}
