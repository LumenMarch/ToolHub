import { api } from './client'
import type { User } from './types'

export async function getMe(): Promise<User> {
  const response = await api.get<User>('/users/me')
  return response.data
}

export async function loginSession(username: string, password: string): Promise<User> {
  const body = new URLSearchParams()
  body.append('username', username)
  body.append('password', password)
  const response = await api.post<User>('/auth/session', body)
  return response.data
}

export async function registerAccount(username: string, password: string): Promise<User> {
  const response = await api.post<User>('/auth/register', { username, password })
  return response.data
}

export async function logoutSession(): Promise<void> {
  await api.post('/auth/logout')
}
