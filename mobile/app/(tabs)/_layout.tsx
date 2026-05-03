import { Tabs } from 'expo-router'

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: '#FC4C02' }}>
      <Tabs.Screen name="index" options={{ title: 'Activities' }} />
      <Tabs.Screen name="zones" options={{ title: 'Zones' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
    </Tabs>
  )
}
