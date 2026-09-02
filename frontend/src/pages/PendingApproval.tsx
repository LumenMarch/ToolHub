import { useContext } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'

import { BrandMark } from '@/components/BrandMark'
import { ThemeToggle } from '@/components/ThemeToggle'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { AuthContext } from '@/context/AuthContext'

const PendingApproval: React.FC = () => {
  const { user, logout } = useContext(AuthContext)
  const navigate = useNavigate()

  if (user?.status === 'approved') {
    return <Navigate to="/" replace />
  }
  if (user?.status === 'rejected') {
    return <Navigate to="/login" replace />
  }

  const handleLogout = async () => {
    try {
      await logout()
    } finally {
      navigate('/login')
    }
  }

  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center bg-background p-6">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <Card className="w-full max-w-md">
        <CardHeader>
          <BrandMark />
          <CardTitle>账号待审批</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertTitle>审核中</AlertTitle>
            <AlertDescription>
              你好，{user?.username}。注册申请已提交，审批通过后会自动进入工具台。
            </AlertDescription>
          </Alert>
        </CardContent>
        <CardFooter>
          <Button variant="outline" onClick={() => void handleLogout()}>
            退出登录
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}

export default PendingApproval
