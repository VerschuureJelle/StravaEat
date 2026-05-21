import { Tabs } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { W as C } from '../../lib/themeWarm'

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarActiveTintColor: C.accent,
      tabBarInactiveTintColor: C.text3,
      tabBarStyle: { backgroundColor: C.surface, borderTopColor: C.border, borderTopWidth: 1 },
    }}>
      <Tabs.Screen
        name="today"
        options={{
          title: 'Today',
          tabBarIcon: ({ color, size }) => <Ionicons name="calendar-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="index"
        options={{
          title: 'History',
          tabBarIcon: ({ color, size }) => <Ionicons name="flash-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size }) => <Ionicons name="settings-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen name="home" options={{ href: null }} />
      <Tabs.Screen name="nutrition" options={{ href: null }} />
      <Tabs.Screen name="planner" options={{ href: null }} />
      <Tabs.Screen name="coach" options={{ href: null }} />
      <Tabs.Screen name="meals" options={{ href: null }} />
      <Tabs.Screen name="zones" options={{ href: null }} />
      <Tabs.Screen name="profile" options={{ href: null }} />
    </Tabs>
  )
}
