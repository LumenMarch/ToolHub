import { useContext, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'

import { BrandMark } from '@/components/BrandMark'
import { ThemeToggle } from '@/components/ThemeToggle'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Field,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { AuthContext } from '@/context/AuthContext'
import { isBackendUnreachable } from '@/hooks/use-hitokoto'
import { pageTitle } from '@/lib/title'
import api from '@/api/axios'

const UNREACHABLE_ERROR = '暂时无法连接，请稍后重试'

const Login: React.FC = () => {
  const [isLogin, setIsLogin] = useState(true)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { login, user } = useContext(AuthContext)
  const navigate = useNavigate()

  const displayError = error
  const submitLabel = isLogin ? '登录' : '注册'

  useEffect(() => {
    document.title = pageTitle()
  }, [])

  useEffect(() => {
    if (user) {
      navigate('/')
    }
  }, [user, navigate])

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    setLoading(true)

    try {
      if (isLogin) {
        const formData = new URLSearchParams()
        formData.append('username', username)
        formData.append('password', password)
        const response = await api.post('/auth/session', formData)
        login(response.data)
        navigate('/')
      } else {
        await api.post('/auth/register', { username, password })
        setIsLogin(true)
      }
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        if (isBackendUnreachable(err)) {
          setError(UNREACHABLE_ERROR)
        } else {
          const detail = err.response?.data?.detail
          setError(typeof detail === 'string' ? detail : '系统发生错误。')
        }
      } else {
        setError(UNREACHABLE_ERROR)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center bg-background p-6">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <BrandMark />
          <CardTitle>{isLogin ? '登录' : '注册'}</CardTitle>
          <CardDescription>
            {isLogin ? '使用账号进入工具台。' : '提交注册后等待管理员审批。'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={(event) => void handleSubmit(event)}>
            <FieldGroup>
              {displayError ? (
                <Alert variant="destructive">
                  <AlertTitle>无法继续</AlertTitle>
                  <AlertDescription id="auth-error">{displayError}</AlertDescription>
                </Alert>
              ) : null}
              <Field data-invalid={Boolean(displayError) || undefined}>
                <FieldLabel htmlFor="username">用户名</FieldLabel>
                <Input
                  id="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoComplete="username"
                  required
                  aria-invalid={Boolean(displayError)}
                  aria-describedby={displayError ? 'auth-error' : undefined}
                />
              </Field>
              <Field data-invalid={Boolean(displayError) || undefined}>
                <FieldLabel htmlFor="password">密码</FieldLabel>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete={isLogin ? 'current-password' : 'new-password'}
                  required
                  aria-invalid={Boolean(displayError)}
                  aria-describedby={displayError ? 'auth-error' : undefined}
                />
              </Field>
              <Field>
                <Button type="submit" disabled={loading}>
                  {loading ? <Spinner data-icon="inline-start" /> : null}
                  {submitLabel}
                </Button>
              </Field>
            </FieldGroup>
          </form>
        </CardContent>
        <CardFooter>
          <Button
            type="button"
            variant="link"
            className="px-0"
            onClick={() => {
              setIsLogin(!isLogin)
              setError('')
            }}
          >
            {isLogin ? '没有账号？注册' : '已有账号？登录'}
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}

export default Login
