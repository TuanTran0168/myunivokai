"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

export interface LoginCredentials {
  email: string;
  password: string;
}

interface LoginErrorPayload {
  error?: { message?: string };
}

async function login(credentials: LoginCredentials): Promise<void> {
  const response = await fetch("/api/admin/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(credentials)
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as LoginErrorPayload;
    throw new Error(payload.error?.message || "Invalid email or password.");
  }
}

export function useLogin() {
  const router = useRouter();
  return useMutation({
    mutationFn: login,
    onSuccess: () => {
      router.push("/");
      router.refresh();
    }
  });
}
