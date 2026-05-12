"use client";

import { Button } from "@repo/ui/components/button";
import { Input } from "@repo/ui/components/input";
import { Textarea } from "@repo/ui/components/textarea";
import { Coins, Download, ImagePlus, Loader2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useAction } from "next-safe-action/hooks";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { generateImageAction } from "../actions";
import {
  DEFAULT_IMAGE_MODEL,
  DEFAULT_IMAGE_SIZE,
  IMAGE_DIMENSION_STEP,
  IMAGE_RESOLUTION_PRESETS,
  normalizeImageSize,
  parseImageSize,
  validateImageSize,
} from "../resolution";

type RecentGeneration = {
  id: string;
  prompt: string;
  imageUrl: string | null;
  createdAt: string;
};

type ResultState = {
  generationId: string;
  imageUrl: string;
  prompt: string;
  model: string;
  size: string;
  revisedPrompt?: string;
};

const defaultDimensions = parseImageSize(DEFAULT_IMAGE_SIZE) || {
  width: 1024,
  height: 1024,
};

interface CreatePageClientProps {
  balance: number;
  creditsPerImage: number;
  recentGenerations: RecentGeneration[];
}

export function CreatePageClient({
  balance: initialBalance,
  creditsPerImage,
  recentGenerations: initialRecent,
}: CreatePageClientProps) {
  const [prompt, setPrompt] = useState("");
  const [width, setWidth] = useState(defaultDimensions.width);
  const [height, setHeight] = useState(defaultDimensions.height);
  const [balance, setBalance] = useState(initialBalance);
  const [result, setResult] = useState<ResultState | null>(null);
  const [recent, setRecent] = useState<RecentGeneration[]>(initialRecent);
  const size = useMemo(
    () => normalizeImageSize(width, height),
    [width, height]
  );
  const sizeCheck = useMemo(() => validateImageSize(size), [size]);

  const { execute, isExecuting } = useAction(generateImageAction, {
    onSuccess: ({ data }) => {
      if (!data) return;
      if (data.error) {
        if (data.error.toLowerCase().includes("insufficient credits")) {
          toast.error("Insufficient credits", {
            description: "You don't have enough credits to generate an image.",
            action: {
              label: "Top up",
              onClick: () => {
                window.location.href = "/dashboard/credits/buy";
              },
            },
          });
        } else {
          toast.error("Generation failed", { description: data.error });
        }
        return;
      }

      if (data.imageUrl && data.generationId) {
        const generationId = data.generationId;
        const imageUrl = data.imageUrl;
        const newResult: ResultState = {
          generationId,
          imageUrl,
          prompt,
          model: data.model || DEFAULT_IMAGE_MODEL,
          size: data.size || size,
        };
        if (data.revisedPrompt) newResult.revisedPrompt = data.revisedPrompt;
        setResult(newResult);
        setBalance((b) => Math.max(0, b - (data.creditsConsumed || 0)));
        setRecent((prev) => [
          {
            id: generationId,
            prompt,
            imageUrl,
            createdAt: new Date().toISOString(),
          },
          ...prev.slice(0, 5),
        ]);
        toast.success("Image generated");
      }
    },
    onError: ({ error }) => {
      toast.error("Generation failed", {
        description: error.serverError || "An unexpected error occurred.",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) {
      toast.error("Please enter a prompt");
      return;
    }
    if (balance < creditsPerImage) {
      toast.error("Insufficient credits", {
        action: {
          label: "Top up",
          onClick: () => {
            window.location.href = "/dashboard/credits/buy";
          },
        },
      });
      return;
    }
    if (!sizeCheck.valid) {
      toast.error("Invalid resolution", { description: sizeCheck.message });
      return;
    }
    setResult(null);
    execute({ prompt: prompt.trim(), size });
  };

  const applyPreset = (presetValue: string) => {
    const preset = IMAGE_RESOLUTION_PRESETS.find(
      (item) => item.value === presetValue
    );
    if (!preset) return;
    const dimensions = parseImageSize(preset.value);
    if (!dimensions) return;
    setWidth(dimensions.width);
    setHeight(dimensions.height);
  };

  return (
    <div className="container mx-auto max-w-5xl px-4 py-8 md:px-6 md:py-12">
      <header className="mb-8 space-y-2">
        <h1 className="font-serif text-3xl font-semibold tracking-tight md:text-4xl">
          Create
        </h1>
        <p className="text-sm text-muted-foreground">
          Describe what you want, and we&apos;ll generate it for you.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="mb-10 space-y-4">
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe the image you want to create..."
          rows={5}
          disabled={isExecuting}
          className="resize-none border-input bg-background text-base"
        />

        <div className="space-y-4 rounded-lg border border-border bg-background p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-3">
              <div>
                <span className="text-sm font-medium text-foreground">
                  Resolution
                </span>
                <p className="mt-1 text-xs text-muted-foreground">
                  Width and height must be multiples of 16.
                </p>
              </div>

              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                {IMAGE_RESOLUTION_PRESETS.map((preset) => {
                  const active = preset.value === size;
                  return (
                    <Button
                      key={preset.value}
                      type="button"
                      variant={active ? "default" : "outline"}
                      disabled={isExecuting}
                      onClick={() => applyPreset(preset.value)}
                      className="h-auto min-h-14 flex-col items-start justify-center gap-0.5 px-3 py-2 text-left"
                    >
                      <span className="text-sm font-medium leading-tight">
                        {preset.label}
                      </span>
                      <span className="text-[11px] leading-tight opacity-80">
                        {preset.detail}
                      </span>
                    </Button>
                  );
                })}
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="space-y-1.5">
                  <label
                    htmlFor="image-width"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    Width
                  </label>
                  <Input
                    id="image-width"
                    type="number"
                    min={256}
                    max={4096}
                    step={IMAGE_DIMENSION_STEP}
                    value={width}
                    onChange={(e) => setWidth(Number(e.target.value) || 0)}
                    disabled={isExecuting}
                    className="w-32"
                  />
                </div>
                <div className="pb-2 text-muted-foreground">x</div>
                <div className="space-y-1.5">
                  <label
                    htmlFor="image-height"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    Height
                  </label>
                  <Input
                    id="image-height"
                    type="number"
                    min={256}
                    max={4096}
                    step={IMAGE_DIMENSION_STEP}
                    value={height}
                    onChange={(e) => setHeight(Number(e.target.value) || 0)}
                    disabled={isExecuting}
                    className="w-32"
                  />
                </div>
                <div className="text-xs text-muted-foreground sm:pb-2">
                  {size}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 lg:justify-end">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Coins className="h-3.5 w-3.5" />
                <span>
                  Balance:{" "}
                  <span className="font-medium text-foreground">{balance}</span>{" "}
                  · Cost:{" "}
                  <span className="font-medium text-foreground">
                    {creditsPerImage}
                  </span>
                  /image
                </span>
              </div>
              <Button type="submit" disabled={isExecuting || !prompt.trim()}>
                {isExecuting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Generating
                  </>
                ) : (
                  <>
                    <ImagePlus className="mr-2 h-4 w-4" />
                    Generate
                  </>
                )}
              </Button>
            </div>
          </div>
          {!sizeCheck.valid && (
            <p className="text-xs text-destructive">{sizeCheck.message}</p>
          )}
        </div>
      </form>

      {isExecuting && (
        <div
          className="mb-10 flex max-w-2xl items-center justify-center rounded-lg border border-dashed bg-muted/30"
          style={{ aspectRatio: `${width} / ${height}` }}
        >
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin" />
            <p className="text-sm">Generating your image...</p>
          </div>
        </div>
      )}

      {result && !isExecuting && (
        <section className="mb-10 space-y-4">
          <div
            className="relative mx-auto max-w-2xl overflow-hidden rounded-lg border bg-muted"
            style={{
              aspectRatio: `${parseImageSize(result.size)?.width || width} / ${parseImageSize(result.size)?.height || height}`,
            }}
          >
            <Image
              src={result.imageUrl}
              alt={result.prompt}
              fill
              sizes="(max-width: 1024px) 100vw, 768px"
              className="object-contain"
              unoptimized
            />
          </div>
          <div className="mx-auto max-w-2xl space-y-3">
            <p className="text-sm text-muted-foreground">{result.prompt}</p>
            <p className="text-xs text-muted-foreground">
              Model:{" "}
              <span className="font-medium text-foreground">
                {result.model}
              </span>{" "}
              · Resolution:{" "}
              <span className="font-medium text-foreground">{result.size}</span>
            </p>
            {result.revisedPrompt && result.revisedPrompt !== result.prompt && (
              <p className="text-xs italic text-muted-foreground">
                Revised: {result.revisedPrompt}
              </p>
            )}
            <div className="flex gap-2">
              <Button asChild variant="outline" size="sm">
                <a
                  href={result.imageUrl}
                  download
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Download className="mr-2 h-4 w-4" />
                  Download
                </a>
              </Button>
            </div>
          </div>
        </section>
      )}

      {recent.length > 0 && (
        <section className="space-y-4">
          <h2 className="font-serif text-xl font-semibold">Recent</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
            {recent.map((g) => (
              <Link
                key={g.id}
                href={`/dashboard/gallery/${g.id}`}
                className="group relative aspect-square overflow-hidden rounded-md border bg-muted"
                title={g.prompt}
              >
                {g.imageUrl ? (
                  <Image
                    src={g.imageUrl}
                    alt={g.prompt}
                    fill
                    className="object-cover transition-transform group-hover:scale-105"
                    unoptimized
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                    <ImagePlus className="h-6 w-6" />
                  </div>
                )}
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
