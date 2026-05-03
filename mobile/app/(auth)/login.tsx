import { Redirect } from 'expo-router'

// login.tsx kept for backwards compat with any existing auth redirects
export default function LoginRedirect() {
  return <Redirect href="/(auth)/" />
}
