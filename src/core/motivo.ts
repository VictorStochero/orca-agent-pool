/** Motivo de uma medida `nao_configurada`, gravado em `erro` como `pasta_ausente:<caminho>` ou `cli_ausente:<executável>`. */
export type MotivoNaoConfigurada = { tipo: 'pasta_ausente' | 'cli_ausente'; valor: string }

/** Separa tipo e valor uma vez só (o valor pode ter `:`, ex.: `C:\…`); null se `erro` não for um motivo conhecido. */
export function motivoNaoConfigurada(erro: string | null | undefined): MotivoNaoConfigurada | null {
  const i = erro?.indexOf(':') ?? -1
  const tipo = i > 0 ? erro!.slice(0, i) : ''
  return tipo === 'pasta_ausente' || tipo === 'cli_ausente' ? { tipo, valor: erro!.slice(i + 1) } : null
}
