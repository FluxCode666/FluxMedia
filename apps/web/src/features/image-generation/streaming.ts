export type ImageStreamEvent =
  | {
      type: "partial_image";
      index?: number;
      partial_image_index?: number;
      b64_json?: string;
      url?: string;
    }
  | {
      type: "completed";
      generationId?: string;
      imageUrl?: string;
      model?: string;
      size?: string;
      revisedPrompt?: string;
      creditsConsumed?: number;
    }
  | {
      type: "error";
      error: string;
      generationId?: string;
      creditsConsumed?: number;
    }
  | {
      type: "done";
    };

export function createImageStreamResponse(
  run: (
    emit: (event: ImageStreamEvent) => Promise<void>
  ) => Promise<ImageStreamEvent | null | undefined>
) {
  const encoder = new TextEncoder();

  return new Response(
    new ReadableStream({
      async start(controller) {
        const emit = async (event: ImageStreamEvent) => {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
          );
        };

        try {
          const finalEvent = await run(emit);
          if (finalEvent) {
            await emit(finalEvent);
          }
        } catch (error) {
          await emit({
            type: "error",
            error: error instanceof Error ? error.message : "Streaming failed",
          });
        } finally {
          await emit({ type: "done" });
          controller.close();
        }
      },
    }),
    {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    }
  );
}
