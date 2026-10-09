import { signIn } from "./actions";

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;
  return <main style={{ maxWidth: 420, margin: "12vh auto", padding: 24 }}>
    <h1>Uppermost operations</h1><p>Sign in with your operator account.</p>
    <form action={signIn} style={{ display: "grid", gap: 16 }}>
      <label>Email<input name="email" type="email" autoComplete="username" required style={{ display: "block", width: "100%", padding: 12 }} /></label>
      <label>Password<input name="password" type="password" autoComplete="current-password" required style={{ display: "block", width: "100%", padding: 12 }} /></label>
      {params.error && <p role="alert">Sign-in failed or operator access is unavailable.</p>}
      <button type="submit" style={{ padding: 14 }}>Sign in</button>
    </form>
  </main>;
}
