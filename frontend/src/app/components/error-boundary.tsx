import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { Button, Result, Space } from 'antd'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('页面渲染失败', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <Result
        status="error"
        title="页面加载失败"
        subTitle={this.state.error.message || '发生了未预期的错误。'}
        extra={
          <Space>
            <Button type="primary" onClick={() => window.location.reload()}>
              重新加载
            </Button>
            <Button onClick={() => { window.location.href = '/' }}>
              返回工作台
            </Button>
          </Space>
        }
      />
    )
  }
}
