This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Environment Variables

Configure the following environment variables:

```bash
# Research Provider: 'perplexity' or 'openai' (default: 'perplexity')
RESEARCH_PROVIDER=perplexity

# Required for Perplexity provider
PPLX_API_KEY=your_perplexity_api_key

# Required for OpenAI provider (and always used for data extraction)
OPENAI_API_KEY=your_openai_api_key
```

### Research Provider Configuration

The application supports two research providers for deep research functionality:

- **Perplexity** (default): Uses Perplexity's `sonar-deep-research` model. Requires `PPLX_API_KEY`.
- **OpenAI**: Uses OpenAI models with automatic fallback (`o3-deep-research` → `gpt-4o`). Requires `OPENAI_API_KEY`.

To switch providers, set the `RESEARCH_PROVIDER` environment variable to either `perplexity` or `openai`. The default is `perplexity` for backward compatibility.

**Note:** `OPENAI_API_KEY` is always required as it's used for data extraction and analysis regardless of the research provider selected.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
