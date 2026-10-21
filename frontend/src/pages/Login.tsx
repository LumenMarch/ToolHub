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
import { isBackendUnreachable, readApiErrorMessage } from '@/lib/api-error'
import { pageTitle } from '@/lib/title'
import api from '@/api/axios'

const UNREACHABLE_ERROR = '暂时无法连接，请稍后重试'

/** 与后端 PASSWORD_MIN_LENGTH 保持一致（backend/app/schemas/user.py）。 */
const PASSWORD_MIN_LENGTH = 6

/** 表单反馈：错误与成功提示互斥，用单一状态避免两个 setState 交织。 */
type Feedback = { kind: 'error' | 'notice'; text: string } | null

const Login: React.FC = () => {
  const [isLogin, setIsLogin] = useState(true)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [loading, setLoading] = useState(false)
  const { login, user } = useContext(AuthContext)
  const navigate = useNavigate()

  const error = feedback?.kind === 'error' ? feedback.text : ''
  const notice = feedback?.kind === 'notice' ? feedback.text : ''
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
    setFeedback(null)

    // 注册前的本地校验：密码下限与后端一致（6 位），省掉一次往返，
    // 且提示文案不受 Pydantic 英文 msg 影响。登录不做长度校验——
    // 旧账号可能是历史规则下创建的，长度由后端判定。
    if (!isLogin && password.length < PASSWORD_MIN_LENGTH) {
      setFeedback({
        kind: 'error',
        text: `密码长度至少 ${PASSWORD_MIN_LENGTH} 位`,
      })
      return
    }

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
        // 注册成功后回到登录态并清空输入，同时提示待审批——
        // 否则用户看到表单被清空、却没有任何"已提交"的反馈。
        setIsLogin(true)
        setUsername('')
        setPassword('')
        setFeedback({
          kind: 'notice',
          text: '请等待管理员审批通过后再登录。',
        })
      }
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        if (isBackendUnreachable(err)) {
          setFeedback({ kind: 'error', text: UNREACHABLE_ERROR })
        } else {
          setFeedback({
            kind: 'error',
            text: readApiErrorMessage(err) ?? '系统发生错误。',
          })
        }
      } else {
        setFeedback({ kind: 'error', text: UNREACHABLE_ERROR })
      }
    } finally {
      setLoading(false)
    }
  }

  /** 登录/注册切换：清空错误与已填凭据，避免把登录页输入带到注册页（或反向）。 */
  const toggleMode = () => {
    setIsLogin(!isLogin)
    setFeedback(null)
    setUsername('')
    setPassword('')
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
              {!displayError && notice ? (
                <Alert role="status">
                  <AlertTitle>注册已提交</AlertTitle>
                  <AlertDescription>{notice}</AlertDescription>
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
            onClick={toggleMode}
          >
            {isLogin ? '没有账号？注册' : '已有账号？登录'}
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}

export default Login
