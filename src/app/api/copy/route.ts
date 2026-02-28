import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

interface CopyRequest {
    textContent: string;
    domain: string;
    pageTitle: string;
}

export async function POST(req: NextRequest) {
    try {
        const { textContent, domain, pageTitle }: CopyRequest = await req.json();

        if (!textContent || textContent.trim().length < 10) {
            return NextResponse.json({
                pitch: `Discover what ${domain} has to offer.`,
                blurbs: [
                    "A modern solution built for today's challenges.",
                    "Streamlined experience designed for efficiency.",
                    "Trusted by teams who demand the best.",
                ],
                twitter: `Check out ${domain} — a product worth exploring. 🚀`,
                tagline: `${domain} — Built for what's next.`,
            });
        }

        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            temperature: 0.7,
            max_tokens: 500,
            messages: [
                {
                    role: "system",
                    content: `You are an expert SaaS marketing copywriter. You write punchy, concise, premium-sounding copy. Never use clichés like "revolutionize" or "game-changing". Keep it sharp and modern.

Respond ONLY with valid JSON in this exact format:
{
  "pitch": "One compelling sentence (max 15 words) that captures what the product does",
  "blurbs": ["Feature point 1 (max 20 words)", "Feature point 2", "Feature point 3"],
  "twitter": "A tweet-length description (max 200 chars) with one emoji",
  "tagline": "A short tagline (max 8 words)"
}`,
                },
                {
                    role: "user",
                    content: `Write marketing copy for this product.

Domain: ${domain}
Page Title: ${pageTitle}

Extracted site content:
${textContent.slice(0, 2000)}`,
                },
            ],
        });

        const raw = completion.choices[0]?.message?.content || "";

        // Parse JSON from the response
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error("Failed to parse AI response");
        }

        const copy = JSON.parse(jsonMatch[0]);

        return NextResponse.json(copy);
    } catch (error) {
        console.error("Copy generation error:", error);

        // Fallback copy if AI fails
        const domain = (await req.clone().json()).domain || "this product";
        return NextResponse.json({
            pitch: `Discover what ${domain} has to offer.`,
            blurbs: [
                "A modern solution built for today's challenges.",
                "Streamlined experience designed for efficiency.",
                "Trusted by teams who demand the best.",
            ],
            twitter: `Check out ${domain} — a product worth exploring. 🚀`,
            tagline: `${domain} — Built for what's next.`,
        });
    }
}
