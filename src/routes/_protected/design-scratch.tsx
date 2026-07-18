import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_protected/design-scratch")({
  component: DesignScratch,
});

const swatches = [
  { name: "background", cls: "bg-background" },
  { name: "surface", cls: "bg-surface" },
  { name: "surface-2", cls: "bg-surface-2" },
  { name: "foreground", cls: "bg-foreground" },
  { name: "muted-foreground", cls: "bg-muted-foreground" },
  { name: "border", cls: "bg-border" },
  { name: "primary", cls: "bg-primary" },
  { name: "cream", cls: "bg-cream" },
  { name: "charcoal", cls: "bg-charcoal" },
  { name: "off-white", cls: "bg-off-white" },
  { name: "destructive", cls: "bg-destructive" },
] as const;

const opacities = [83, 82, 40, 4, 3] as const;

function DesignScratch() {
  const [dark, setDark] = useState(false);

  const toggleDark = () => {
    setDark((d) => {
      const next = !d;
      document.documentElement.classList.toggle("dark", next);
      return next;
    });
  };

  return (
    <div className="mx-auto max-w-5xl py-16">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-display">Design foundation</h1>
          <p className="mt-4 text-body-lg text-muted-foreground">
            Phase 1 scratch page — DESIGN.md tokens in light &amp; dark.
          </p>
        </div>
        <Button variant="outline" onClick={toggleDark}>
          {dark ? "Light mode" : "Dark mode"}
        </Button>
      </div>

      <section className="mt-16">
        <h2 className="text-sub">Colors</h2>
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {swatches.map((s) => (
            <div key={s.name} className="overflow-hidden rounded-lg border border-border">
              <div className={`h-16 ${s.cls}`} />
              <div className="bg-surface px-3 py-2 text-caption text-muted-foreground">
                {s.name}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-6">
          <p className="text-caption text-muted-foreground">
            Opacity-derived grays (foreground at 83 / 82 / 40 / 4 / 3)
          </p>
          <div className="mt-2 flex overflow-hidden rounded-lg border border-border">
            {opacities.map((o) => (
              <div key={o} className={`h-12 flex-1 bg-foreground/${o}`} />
            ))}
          </div>
        </div>
      </section>

      <section className="mt-16">
        <h2 className="text-sub">Type scale</h2>
        <div className="mt-6 flex flex-col gap-4 rounded-xl border border-border bg-surface p-8">
          <p className="text-display">Display 60</p>
          <p className="text-display-alt">Display alt 60/480</p>
          <p className="text-section">Section 48</p>
          <p className="text-sub">Sub 36</p>
          <p className="text-card-title">Card title 20</p>
          <p className="text-body-lg">Body large 18 — การแปลนิยายที่สม่ำเสมอ</p>
          <p className="text-base">Body 16 — สวัสดีครับ นี่คือข้อความภาษาไทย</p>
          <p className="font-reader text-base">Reader (Sarabun) — อ่านนิยายยาว ๆ ได้สบายตา</p>
          <p className="text-caption text-muted-foreground">Caption 14 — metadata</p>
        </div>
      </section>

      <section className="mt-16">
        <h2 className="text-sub">Buttons</h2>
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <Button>Primary dark</Button>
          <Button variant="outline">Ghost / outline</Button>
          <Button variant="cream">Cream surface</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="pill" size="icon" aria-label="Pill action">
            ✦
          </Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="link">Link</Button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <Button size="sm">Small</Button>
          <Button>Default</Button>
          <Button size="lg">Large</Button>
          <Button disabled>Disabled</Button>
        </div>
      </section>

      <section className="mt-16">
        <h2 className="text-sub">Card &amp; inputs</h2>
        <Card className="mt-6 max-w-md">
          <CardHeader>
            <CardTitle>Project Hail the King</CardTitle>
            <CardDescription>EN → TH · 12 chapters</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="title">Chapter title</Label>
                <Input id="title" placeholder="Chapter 12.5 — Interlude" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="raw">Raw text</Label>
                <Textarea id="raw" placeholder="Paste raw chapter text…" />
              </div>
              <div className="flex gap-2">
                <Badge>translated</Badge>
                <Badge className="bg-muted text-muted-foreground">queued</Badge>
              </div>
            </div>
          </CardContent>
          <CardFooter className="gap-2">
            <Button size="sm">Save</Button>
            <Button size="sm" variant="outline">
              Cancel
            </Button>
          </CardFooter>
        </Card>
      </section>
    </div>
  );
}
