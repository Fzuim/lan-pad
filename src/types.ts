export type NetworkAddress = {
  iface: string
  address: string
  url: string
}

export type NetworkInfo = {
  primary: string
  primaryAddress: string
  addresses: NetworkAddress[]
}

export type DocMeta = {
  id: string
  title: string
  created_at: number
  updated_at: number
  last_editor: string | null
  online: number
  url?: string
}

export type UserInfo = {
  name: string
  color: string
}

export type PresenceUser = {
  clientId: number
  name: string
  color: string
  isSelf: boolean
}

export type AssetResult = {
  url: string
  width: number | null
  height: number | null
  mime: string
}
