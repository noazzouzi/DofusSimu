/**
 * (E4, docs/design/ai.md §3.3, §6.4) Révisions des combattants : `Fighter.rev` reçoit une valeur NEUVE, unique dans le
 * processus (compteur strictement croissant), à chaque recalcul des caractéristiques et à chaque changement de case.
 *
 * Unique et non « +1 par combattant » : deux clones frères issus du même parent (faisceau de l'IA) modifient le même
 * combattant différemment ; avec un simple +1 ils obtiendraient la même révision pour deux états différents et une
 * clé de cache `(id, rev)` partagée entre nœuds renverrait une valeur fausse. Ici, `(id, rev)` égaux ⇒ même état
 * (caractéristiques, buffs/états, case), dans n'importe quel clone.
 *
 * Valeur opaque : elle dépend de l'historique du processus (nombre de combats déjà joués), elle ne sert QUE de clé de
 * cache et ne doit jamais entrer dans une décision, un hash d'état ou un résumé (déterminisme, §13.2).
 */

let lastRev = 0

/** Donne à `f` une révision neuve (unique dans le processus). */
export function bumpRev(f: { rev?: number }): void {
  f.rev = ++lastRev
}
