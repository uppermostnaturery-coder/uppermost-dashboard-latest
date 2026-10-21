"use client";
import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';
export default function GlobalError({ error, reset }: {
    error: Error;
    reset: () => void;
}) { useEffect(() => { Sentry.captureException(error); }, [error]); return <html><body><h1>Dashboard unavailable</h1><p>Please retry in a moment.</p><button onClick={reset}>Try again</button></body></html>; }
