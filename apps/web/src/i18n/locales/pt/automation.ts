// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { automation as enAutomation } from "../../en/automation";

/** Machine-translated; unreviewed (see ../../README.md). */
export const automation: Record<keyof typeof enAutomation, string> = {
  // ---- workflows: tables and checks (core/workflows.ts) ----
  "automation.workflows.environment.local": "Local",
  "automation.workflows.environment.dev": "Desenvolvimento",
  "automation.workflows.environment.staging": "Homologação",
  "automation.workflows.environment.production": "PRODUÇÃO",
  "automation.workflows.environment.productionLive": "PRODUÇÃO (altera sistemas em operação)",

  "automation.workflows.runStatus.queued": "Na fila",
  "automation.workflows.runStatus.running": "Em execução",
  "automation.workflows.runStatus.waiting_approval": "Aguardando sua aprovação",
  "automation.workflows.runStatus.compensating": "Desfazendo etapas anteriores",
  "automation.workflows.runStatus.succeeded": "Concluída com sucesso",
  "automation.workflows.runStatus.rejected": "Rejeitada por você",
  "automation.workflows.runStatus.failed": "Falhou",
  "automation.workflows.runStatus.failed_needs_attention": "Falhou: requer sua atenção",
  "automation.workflows.runStatus.cancelled": "Cancelada",
  "automation.workflows.runStatus.interrupted": "Interrompida (o Phoenix foi reiniciado)",
  "automation.workflows.runStatus.refused": "Recusada: não tinha permissão para executar",

  "automation.workflows.stepStatus.running": "Em execução",
  "automation.workflows.stepStatus.waiting": "Aguardando",
  "automation.workflows.stepStatus.succeeded": "Concluída com sucesso",
  "automation.workflows.stepStatus.failed": "Falhou",
  "automation.workflows.stepStatus.timed_out": "Tempo esgotado (resultado desconhecido)",
  "automation.workflows.stepStatus.rejected": "Rejeitada",
  "automation.workflows.stepStatus.expired": "Expirada",
  "automation.workflows.stepStatus.unknown": "Resultado desconhecido",

  "automation.workflows.authorisation.notNeeded": "Nenhuma autorização necessária",
  "automation.workflows.authorisation.authorised": "Autorizado para produção",
  "automation.workflows.authorisation.notAuthorised": "NÃO autorizado: os disparos são recusados",

  "automation.workflows.expiry.invalid": "Isso não é uma data e hora válidas.",
  "automation.workflows.expiry.past": "A expiração deve estar no futuro.",
  "automation.workflows.expiry.tooFar":
    "A expiração pode ser de no máximo {days} dias a partir de agora.",
  "automation.workflows.refused.noReason": "Nenhum motivo foi informado.",
  "automation.workflows.payload.invalidJson": "O payload não é um JSON válido.",
  "automation.workflows.payload.notObject": "O payload deve ser um objeto JSON, como '{}'.",
  "automation.workflows.payload.tooMany": "O payload pode ter no máximo {max} chaves.",

  // ---- workflows: the list ----
  "automation.workflows.title": "Fluxos de trabalho",
  "automation.workflows.intro":
    "Um workflow reage a um evento com uma lista fixa de etapas. Um workflow que altera a produção não faz nada até que você autorize exatamente a definição que revisou.",
  "automation.workflows.empty": "Nenhum workflow ainda. Crie um revisando uma definição abaixo.",
  "automation.workflows.row.runsWhen": "Executa quando {event} ocorre · versão {version}",
  "automation.workflows.row.cannotRun": "Não pode executar: {problems}",
  "automation.workflows.row.metrics": "{started} execução(ões), {succeeded} com sucesso",

  // ---- workflows: the numbers of one workflow ----
  "automation.workflows.metrics.title": "Números",
  "automation.workflows.metrics.label": "Métricas",
  "automation.workflows.metrics.none":
    "Este workflow ainda não foi executado, então não há números.",
  "automation.workflows.metrics.started": "Execuções iniciadas",
  "automation.workflows.metrics.succeeded": "Com sucesso",
  "automation.workflows.metrics.failed": "Com falha",
  "automation.workflows.metrics.attention": "Requerem sua atenção",
  "automation.workflows.metrics.cancelled": "Canceladas",
  "automation.workflows.metrics.refused": "Recusadas",
  "automation.workflows.metrics.interrupted": "Interrompidas",
  "automation.workflows.metrics.stepsFailed": "Etapas com falha",
  "automation.workflows.metrics.stepsFailedValue": "{count} ({percent}% das etapas)",
  "automation.workflows.metrics.approvalsWaiting": "Aprovações pendentes",
  "automation.workflows.metrics.approvalsOutcome": "Aprovações aprovadas / rejeitadas / expiradas",
  "automation.workflows.metrics.approvalsOutcomeValue": "{approved} / {rejected} / {expired}",
  "automation.workflows.metrics.runTime": "Tempo de execução (mediana / percentil 90)",
  "automation.workflows.metrics.runTimeValue":
    "{median} ms / {p90} ms em {samples, plural, one {# execução} other {# execuções}}",
  "automation.workflows.metrics.noFinishedRuns": "nenhuma execução concluída",

  // ---- workflows: the definition editor ----
  "automation.workflows.editor.titleEdit": "Editar definição",
  "automation.workflows.editor.titleCreate": "Criar workflow",
  "automation.workflows.editor.introExisting":
    'Insira a definição JSON completa. Mantenha "enabled": {enabled}; esta edição preserva o estado atual do interruptor. Salvar não autoriza nem executa o workflow. Verificar nunca salva.',
  "automation.workflows.editor.introNew":
    'Insira a definição JSON completa. Novas definições devem ter "enabled": false. Salvar não as executa, ativa nem autoriza. Verificar nunca salva.',
  "automation.workflows.editor.label": "Definição do workflow (JSON)",
  "automation.workflows.editor.check": "Verificar rascunho",
  "automation.workflows.editor.enterJson":
    "Insira uma definição de workflow em JSON antes de verificar.",
  "automation.workflows.editor.notObject": "Uma definição de workflow deve ser um objeto JSON.",
  "automation.workflows.editor.keepEnabled":
    'Mantenha "enabled": {enabled}. Altere o interruptor separadamente após salvar.',
  "automation.workflows.editor.setDisabled":
    'Defina "enabled": false. Salvar uma nova definição não deve ativá-la.',
  "automation.workflows.editor.keepId":
    "A edição deve manter o mesmo ID de workflow. Use Criar workflow para um novo ID.",
  "automation.workflows.editor.notValid": "Inválido: {problems}",
  "automation.workflows.editor.noHash": "A validação não retornou um hash de definição válido.",
  "automation.workflows.editor.hashDiffers":
    "O hash da definição salva difere do hash revisado. Revise a definição armazenada antes de usá-la.",
  "automation.workflows.editor.savedExisting":
    "Definição salva. O estado atual do interruptor não mudou; salvar não a autoriza.",
  "automation.workflows.editor.savedNew":
    "Definição salva desativada. Salvar não a autoriza nem a ativa.",
  "automation.workflows.editor.reviewed": "Definição revisada",
  "automation.workflows.editor.validLead": "Rascunho válido.",
  "automation.workflows.editor.valid":
    "{lead} Revise esta definição e este hash exatos antes de salvar. Qualquer alteração exige nova verificação.",
  "automation.workflows.editor.toSave": "Definição a salvar",
  "automation.workflows.editor.hash": "Hash validado: {hash}",
  "automation.workflows.editor.authRequired": "Autorização necessária separadamente: {reasons}",
  "automation.workflows.editor.authNotRequired": "Nenhuma autorização necessária.",
  "automation.workflows.editor.switchOn": "Salvar nunca autoriza; o interruptor continua ligado.",
  "automation.workflows.editor.switchOff":
    "Salvar nunca autoriza; o interruptor continua desligado.",
  "automation.workflows.editor.switchNew":
    "Salvar nunca autoriza; o novo workflow continua desligado.",
  "automation.workflows.editor.confirm": "Confirmar: salvar exatamente esta definição",
  "automation.workflows.editor.reviewStored": "Revisar workflow armazenado",

  // ---- workflows: checking the stored definition ----
  "automation.workflows.validate.button": "Verificar a definição",
  "automation.workflows.validate.dryRun": "Uma simulação. Nada é salvo e nada é executado.",
  "automation.workflows.validate.validLead": "Válida.",
  "automation.workflows.validate.valid": "{lead} Hash {hash}. {authorisation}",
  "automation.workflows.validate.needsAuth": "Requer sua autorização: {reasons}.",
  "automation.workflows.validate.noAuth": "Nenhuma autorização necessária.",
  "automation.workflows.validate.invalidLead": "Inválida.",
  "automation.workflows.validate.invalid":
    "{lead} {count, plural, one {# problema:} other {# problemas:}}",
  "automation.workflows.validate.problems": "Problemas",

  // ---- workflows: authorising ----
  "automation.workflows.authorise.title": "Autorizar para produção",
  "automation.workflows.authorise.notNeeded": "Este workflow não precisa de autorização.",
  "automation.workflows.authorise.why": "Por que ele precisa da sua autorização:",
  "automation.workflows.authorise.reasons": "Motivos",
  "automation.workflows.authorise.intro":
    "Isto permitirá que o workflow {name} execute sempre que {event} ocorrer, sem nova pergunta para estas etapas, a menos que o workflow peça:",
  "automation.workflows.authorise.allowed": "O que poderia ser executado",
  "automation.workflows.authorise.noTools": "Não chama nenhuma ferramenta.",
  "automation.workflows.authorise.step": "A etapa {step} chama {tool}",
  "automation.workflows.authorise.stepUndo": "A etapa {step} chama {tool} (desfazer: {undo})",
  "automation.workflows.authorise.being":
    "Definição sendo autorizada: versão {version}, hash {hash}",
  "automation.workflows.authorise.expires": "Expira {hint}",
  "automation.workflows.authorise.expiresHint": "(opcional, em até {days} dias)",
  "automation.workflows.authorise.submit": "Autorizar exatamente esta definição",
  "automation.workflows.authorise.done":
    "Versão {version} autorizada. Qualquer alteração posterior na definição encerra esta autorização.",

  // ---- workflows: run now ----
  "automation.workflows.runNow.title": "Executar agora",
  "automation.workflows.runNow.intro":
    "Inicia o workflow manualmente, com as mesmas verificações de quando seu evento ocorre: ativado, não interrompido pela parada de emergência, válido e autorizado se alterar a produção.",
  "automation.workflows.runNow.payload": "Dados que o evento teria carregado {hint}",
  "automation.workflows.runNow.payloadHint": "(um objeto JSON, opcional)",
  "automation.workflows.runNow.button": "Executar agora",
  "automation.workflows.runNow.cannotRun": "Não pode executar: {problems}",
  "automation.workflows.runNow.enableFirst": "Ative o workflow para executá-lo.",
  "automation.workflows.runNow.refusedLead": "O início foi recusado.",
  "automation.workflows.runNow.seeRefused": "Ver a execução recusada",
  "automation.workflows.runNow.started": "Iniciada. {link}",
  "automation.workflows.runNow.follow": "Acompanhar a execução",

  // ---- workflows: one workflow ----
  "automation.workflows.detail.all": "Todos os workflows",
  "automation.workflows.detail.backAll": "← Todos os workflows",
  "automation.workflows.detail.productionLead": "Produção.",
  "automation.workflows.detail.production":
    "{lead} Este workflow pode alterar sistemas em operação. Ele só executa enquanto você tiver autorizado a definição exata.",
  "automation.workflows.detail.cannotRunNow": "Não pode executar agora:",
  "automation.workflows.detail.definition": "Definição",
  "automation.workflows.detail.versionHash": "Versão {version} · hash {hash}",
  "automation.workflows.detail.runsWhen": "Executa quando {event} ocorre.",
  "automation.workflows.detail.runsWhenAnd": "Executa quando {event} ocorre e {condition}.",
  "automation.workflows.detail.tools": "Ferramentas que pode chamar",
  "automation.workflows.detail.toolsLabel": "Ferramentas",
  "automation.workflows.detail.none": "Nenhuma.",
  "automation.workflows.detail.toolStep": "Etapa {step}: {tool}",
  "automation.workflows.detail.flagged": "Ação de produção ou crítica",
  "automation.workflows.detail.declaredUndo": "desfazer declarado: {undo}",
  "automation.workflows.detail.definitionText": "Definição (texto somente leitura, com rolagem)",
  "automation.workflows.detail.unreadable": "Não foi possível ler a definição armazenada.",
  "automation.workflows.detail.switch": "Interruptor",
  "automation.workflows.detail.enable": "Ativar",
  "automation.workflows.detail.disable": "Desativar",
  "automation.workflows.detail.switchNote":
    "Ativar não autoriza. Um workflow de produção ativado e não autorizado registra todos os disparos como recusados.",
  "automation.workflows.detail.authorisations": "Autorizações",
  "automation.workflows.detail.noneYet": "Nenhuma ainda.",
  "automation.workflows.detail.inForce": "Em vigor",
  "automation.workflows.detail.revoked": "Revogada",
  "automation.workflows.detail.notInForce": "Fora de vigor",
  "automation.workflows.detail.authorisedBy": "por {by} em {date}",
  "automation.workflows.detail.authExpires": "expira em {date}",
  "automation.workflows.detail.authChanged": "a definição mudou ou ela expirou",
  "automation.workflows.detail.forHash": "para o hash {hash}",
  "automation.workflows.detail.confirmRevoke": "Confirmar: revogar autorização",
  "automation.workflows.detail.revoke": "Revogar autorização…",
  "automation.workflows.detail.revokeNote": "As execuções em andamento param na próxima etapa.",
  "automation.workflows.detail.recentRuns": "Execuções recentes",
  "automation.workflows.detail.noRuns": "Nenhuma execução ainda.",

  // ---- workflows: runs and steps ----
  "automation.workflows.run.needsLook": "(requer atenção)",
  "automation.workflows.run.notSuccess": "(sem sucesso)",
  "automation.workflows.run.nowAtStep": "agora na etapa {step}",
  "automation.workflows.run.atStep": "na etapa {step}",
  "automation.workflows.run.backToWorkflow": "Voltar ao workflow",
  "automation.workflows.run.title": "Execução de {name}",
  "automation.workflows.run.created": "Criada em {date}",
  "automation.workflows.run.finished": "concluída em {date}",
  "automation.workflows.run.chainDepth": "profundidade da cadeia {depth}",
  "automation.workflows.run.waitingForYou": "Aguardando você",
  "automation.workflows.run.stop": "Parar esta execução",
  "automation.workflows.run.confirmCancel": "Confirmar: cancelar esta execução",
  "automation.workflows.run.keepRunning": "Continuar executando",
  "automation.workflows.run.cancel": "Cancelar esta execução…",
  "automation.workflows.run.cancelNote":
    "Cancelar não executa as etapas de desfazer declaradas. Uma etapa já em andamento ainda pode terminar.",
  "automation.workflows.run.trigger": "O que a iniciou",
  "automation.workflows.run.triggerText": "Gatilho (texto simples, com rolagem)",
  "automation.workflows.run.stepsHeading": "Etapas ({count})",
  "automation.workflows.run.stepsLabel": "Etapas",
  "automation.workflows.run.noSteps": "Nenhuma etapa foi iniciada.",
  "automation.workflows.step.undo": "Desfazer: {step}",
  "automation.workflows.step.attempts": "{count, plural, one {# tentativa} other {# tentativas}}",
  "automation.workflows.step.changesState": "Altera o estado",
  "automation.workflows.step.destructive": "{lead}: esta etapa pode alterar um sistema real.",
  "automation.workflows.step.tool": "Ferramenta {tool}",
  "automation.workflows.step.input": "Entrada da etapa {step} (texto simples, com rolagem)",
  "automation.workflows.step.output": "Saída da etapa {step} (texto simples, com rolagem)",

  // ---- plans: tables and checks (core/plans.ts) ----
  "automation.plans.status.draft": "Rascunho: ainda não proposto",
  "automation.plans.status.proposed": "Proposto: aguardando sua aprovação",
  "automation.plans.status.approved": "Aprovado: pronto para criar",
  "automation.plans.status.creating": "Criando tarefas…",
  "automation.plans.status.created": "Criado",
  "automation.plans.status.failed": "Falhou: algumas tarefas não foram criadas",
  "automation.plans.status.cancelled": "Cancelado",
  "automation.plans.basis.meeting": "da reunião",
  "automation.plans.basis.suggested": "sugerido pelo modelo",
  "automation.plans.basis.user": "escrito por você",
  "automation.plans.run.pending": "Não iniciada",
  "automation.plans.run.attempting": "Em andamento",
  "automation.plans.run.created": "Criada",
  "automation.plans.run.failed": "Falhou",
  "automation.plans.tool.githubIssue": "Criar uma issue do GitHub",
  "automation.plans.tool.frappeTask": "Criar uma tarefa do Frappe",
  "automation.plans.kind.decision": "decisão",
  "automation.plans.kind.action_item": "item de ação",
  "automation.plans.kind.requirement": "requisito",
  "automation.plans.authorship.rules":
    "Rascunho baseado em regras: nenhuma IA o escreveu, ele apenas reformula o item da reunião.",
  "automation.plans.authorship.model":
    "Saída do modelo ({model}): confira com a reunião antes de aprovar.",
  "automation.plans.destination.github": "Repositório do GitHub {repository}",
  "automation.plans.destination.frappe": "Site Frappe {site}",
  "automation.plans.problem.repository": 'O repositório deve ter o formato "owner/name".',
  "automation.plans.problem.site": "Esse não é um nome de site Frappe válido.",
  "automation.plans.problem.titleEmpty": "O título não pode ficar vazio.",
  "automation.plans.problem.titleLong": "O título é maior que {max}.",
  "automation.plans.problem.summaryEmpty": "O resumo não pode ficar vazio.",
  "automation.plans.problem.summaryLong": "O resumo é maior que {max}.",
  "automation.plans.problem.taskCount": "Um plano precisa de 1 a {max} tarefas.",
  "automation.plans.problem.taskTitle": "A tarefa {n} precisa de um título.",
  "automation.plans.problem.bodyLong": "O corpo é maior que {max}.",
  "automation.plans.problem.labelCount": "No máximo {max} rótulos.",
  "automation.plans.problem.labelLong": "Um rótulo é maior que {max}.",

  // ---- plans: make a plan from a meeting item ----
  "automation.plans.off": "O planejamento está desativado.",
  "automation.plans.make.open": "Criar um plano…",
  "automation.plans.make.openFrom": "Criar um plano a partir de {kind}: {text}",
  "automation.plans.make.intro":
    "Um plano é um rascunho de tarefas de engenharia. Nada é criado até que você o aprove e confirme cada tarefa.",
  "automation.plans.make.where": "Para onde iriam as tarefas?",
  "automation.plans.make.githubIssues": "Issues do GitHub",
  "automation.plans.make.frappeTasks": "Tarefas do Frappe",
  "automation.plans.make.repository": "Repositório (owner/name)",
  "automation.plans.make.site": "Site Frappe",
  "automation.plans.make.chooseSite": "Escolha um site",
  "automation.plans.make.drafting": "Redigindo o plano…",
  "automation.plans.make.draft": "Redigir um plano",
  "automation.plans.make.localModel":
    "Um modelo local pode levar um minuto. Nada é enviado para nenhum outro lugar.",
  "automation.plans.make.drafted": "Plano redigido.",
  "automation.plans.make.openPlan": "Abrir o plano",

  // ---- plans: on a meeting ----
  "automation.plans.meeting.title": "Planos e tarefas desta reunião",
  "automation.plans.meeting.plans": "Planos",
  "automation.plans.meeting.summary":
    "{status} · {count, plural, one {# tarefa} other {# tarefas}} · {system}",
  "automation.plans.meeting.tasksCreated": "Tarefas criadas",
  "automation.plans.meeting.tasksLabel": "Tarefas criadas a partir desta reunião",
  "automation.plans.link.frappeTask": "Tarefa {id}",
  "automation.plans.link.detail": "tarefa {index} de {plan} · aprovada em {date}",
  "automation.plans.link.itsPlan": "seu plano",

  // ---- plans: the editor ----
  "automation.plans.editor.label": "Editar o plano",
  "automation.plans.editor.title": "Título {hint}",
  "automation.plans.editor.summary": "Resumo {hint}",
  "automation.plans.editor.upTo": "(até {max})",
  "automation.plans.editor.tasks": "Tarefas {hint}",
  "automation.plans.editor.tasksRange": "(1 a {max})",
  "automation.plans.editor.task": "Tarefa {n}",
  "automation.plans.editor.taskTitle": "Título da tarefa {n}",
  "automation.plans.editor.taskBody": "Corpo da tarefa {n} {hint}",
  "automation.plans.editor.taskLabels": "Rótulos da tarefa {n} {hint}",
  "automation.plans.editor.labelsHint": "(separados por vírgula, até {max})",
  "automation.plans.editor.removeTask": "Remover a tarefa {n}",
  "automation.plans.editor.addTask": "Adicionar uma tarefa",
  "automation.plans.editor.note":
    "Salvar devolve o plano a rascunho e limpa qualquer aprovação. Depois você o propõe e o aprova novamente.",
  "automation.plans.editor.save": "Salvar alterações",

  // ---- plans: preview and results ----
  "automation.plans.preview.title": "Exatamente o que seria enviado",
  "automation.plans.preview.intro":
    "Cada tarefa é uma chamada feita em seu nome. Esta é a entrada real, exibida como texto simples.",
  "automation.plans.preview.calls": "Chamadas que seriam feitas",
  "automation.plans.preview.task": "Tarefa {n}: {tool}",
  "automation.plans.preview.decision": "(efeito: {effect}, risco: {risk})",
  "automation.plans.preview.input": "Entrada da tarefa {n} (texto simples, com rolagem)",
  "automation.plans.runs.title": "Tarefa por tarefa",
  "automation.plans.runs.label": "Resultados das tarefas",
  "automation.plans.runs.task": "Tarefa {n}:",
  "automation.plans.runs.attempts": "{count, plural, one {# tentativa} other {# tentativas}}",
  "automation.plans.runs.frappeTask": "Tarefa do Frappe {id}",
  "automation.plans.runs.stopped":
    "Interrompido na tarefa {n}: {message}. Nada depois dela foi criado. Você pode executar Criar novamente: as tarefas que já existem são encontradas, não duplicadas.",

  // ---- plans: one plan ----
  "automation.plans.page.allMeetings": "Todas as reuniões",
  "automation.plans.page.meeting": "← A reunião",
  "automation.plans.page.rules": "Rascunho baseado em regras",
  "automation.plans.page.model": "Saída do modelo",
  "automation.plans.page.destination": "Destino: {destination}",
  "automation.plans.page.from": "De {kind}: {text}",
  "automation.plans.page.owner": "responsável {owner}",
  "automation.plans.page.due": "prazo {due}",
  "automation.plans.page.proposedNotice": "Proposto. Confira a pré-visualização e depois aprove.",
  "automation.plans.page.approvedNotice": "Aprovado. Nada foi criado ainda.",
  "automation.plans.page.savedNotice":
    "Salvo. O plano voltou a ser rascunho; proponha-o para aprová-lo.",
  "automation.plans.page.cancelledNotice": "Cancelado. Nada foi criado.",
  "automation.plans.page.plan": "O plano",
  "automation.plans.page.tasks": "Tarefas ({count})",
  "automation.plans.page.tasksLabel": "Tarefas",
  "automation.plans.page.labels": "Rótulos:",
  "automation.plans.page.edit": "Editar o plano",
  "automation.plans.page.acceptance": "Critérios de aceitação",
  "automation.plans.page.risks": "Riscos",
  "automation.plans.page.questions": "Questões em aberto",
  "automation.plans.frappe.doctype": "DocType do Frappe proposto: {doctype}",
  "automation.plans.frappe.note":
    "Apenas um design sugerido. Criar tarefas não cria este DocType, seus campos, workflow ou permissões.",
  "automation.plans.frappe.fields": "Campos",
  "automation.plans.frappe.fieldsLabel": "Campos propostos do Frappe",
  "automation.plans.frappe.required": "obrigatório",
  "automation.plans.frappe.noFields": "Nenhum campo proposto.",
  "automation.plans.frappe.states": "Estados do workflow",
  "automation.plans.frappe.statesLabel": "Estados de workflow propostos do Frappe",
  "automation.plans.frappe.noStates": "Nenhum estado de workflow proposto.",
  "automation.plans.frappe.permissions": "Permissões",
  "automation.plans.frappe.permissionsLabel": "Permissões propostas do Frappe",
  "automation.plans.frappe.noPermissions": "Nenhuma permissão proposta.",
  "automation.plans.frappe.access": "{role}: {access}",
  "automation.plans.frappe.read": "leitura",
  "automation.plans.frappe.write": "escrita",
  "automation.plans.frappe.create": "criação",
  "automation.plans.frappe.noAccess": "sem acesso",
  "automation.plans.decide.title": "Decidir",
  "automation.plans.decide.fingerprint":
    "Impressão digital do que você está vendo: {hash}. A aprovação cobre exatamente este conteúdo; se o plano mudar, ela é recusada.",
  "automation.plans.decide.propose": "Propor este plano",
  "automation.plans.decide.nameMeeting": "Citar a reunião nas tarefas criadas",
  "automation.plans.decide.approve": "Aprovar exatamente este plano",
  "automation.plans.decide.approved": "Aprovado por {by} em {date}.",
  "automation.plans.decide.approvedNamed":
    "Aprovado por {by} em {date} · a reunião é citada nas tarefas.",
  "automation.plans.decide.understand":
    "Entendo que isto cria {count, plural, one {# tarefa} other {# tarefas}} em {destination}, em meu nome.",
  "automation.plans.decide.createRemaining": "Criar as tarefas restantes",
  "automation.plans.decide.create": "Criar tarefas",
  "automation.plans.decide.waiting": "Aguardando sua aprovação da tarefa {n} de {total}.",
  "automation.plans.decide.waitingNote":
    "O Core pergunta a você antes de cada tarefa ser criada. Responda abaixo; esta página espera o tempo que for preciso.",
  "automation.plans.decide.cancel": "Cancelar este plano",

  // ---- automation settings (AutomationSettings.tsx) ----
  "automation.settings.title": "Automação",
  "automation.settings.intro":
    "A automação fica desativada até você ativá-la. Enquanto estiver desativada, o Fawkes não inicia tarefas nem executa nada por conta própria. Quando ativada, o Fawkes só pode iniciar uma tarefa quando você pedir, como “Diagnosticar uma falha de CI” na aba Chat. Ele lê dados e propõe; qualquer coisa que altere algo aguarda sua aprovação, e você pode cancelar uma tarefa a qualquer momento. Desativar a automação cancela todas as tarefas em execução.",
  "automation.settings.allow": "Permitir que o Fawkes execute as tarefas que eu iniciar",
  "automation.settings.statusOn":
    "A automação está ativada. {active, plural, one {# tarefa está} other {# tarefas estão}} em execução (no máximo {max} ao mesmo tempo).",
  "automation.settings.statusOff":
    "A automação está desativada. {active, plural, one {# tarefa está} other {# tarefas estão}} em execução (no máximo {max} ao mesmo tempo).",
  "automation.settings.unavailable":
    "As configurações de automação não estão disponíveis no Phoenix Core ({error}).",

  // ---- proactive suggestions (ProactiveSettings.tsx) ----
  "automation.proactive.title": "Sugestões proativas",
  "automation.proactive.intro":
    "Desativado por padrão. Quando disponível, o Kage pode sugerir itens de reunião aceitos e sem responsável. Os sinais de engenharia só podem examinar raízes de repositórios monitorados que você adicionar explicitamente; o provedor de avisos não está disponível, por isso nunca informa avisos. A avaliação é manual, a menos que você escolha explicitamente uma periodicidade após aderir. O trabalho agendado roda localmente e respeita horário de silêncio, limites de taxa e parada de emergência.",
  "automation.proactive.status": "Fonte Kage: {source}. As sugestões estão {state} ({cadence}).",
  "automation.proactive.sourceAvailable": "disponível",
  "automation.proactive.sourceUnavailable": "indisponível",
  "automation.proactive.stateOn": "ativadas",
  "automation.proactive.stateOff": "desativadas",
  "automation.proactive.cadenceEvery": "a cada {minutes, plural, one {# minuto} other {# minutos}}",
  "automation.proactive.cadenceManual": "somente manual",
  "automation.proactive.optIn": "Aderir",
  "automation.proactive.enable": "Ativar sugestões proativas",
  "automation.proactive.kageItems": "Itens de ação do Kage aceitos e sem responsável",
  "automation.proactive.engineeringSignals": "Sinais de engenharia de repositórios monitorados",
  "automation.proactive.engineeringSignalsStatus": "Os sinais de engenharia estão {state}.",
  "automation.proactive.cadence": "Periodicidade da avaliação automática",
  "automation.proactive.cadenceOff": "Somente manual (desativada)",
  "automation.proactive.cadence15": "A cada 15 minutos",
  "automation.proactive.cadence30": "A cada 30 minutos",
  "automation.proactive.cadence60": "A cada hora",
  "automation.proactive.cadence1440": "Todos os dias",
  "automation.proactive.quietHours": "Horário de silêncio",
  "automation.proactive.useQuiet": "Usar horário de silêncio",
  "automation.proactive.timezone": "Fuso horário (IANA)",
  "automation.proactive.quietFrom": "Silêncio a partir de",
  "automation.proactive.quietUntil": "Silêncio até",
  "automation.proactive.maxPerHour": "Máximo de sugestões por hora",
  "automation.proactive.preview": "Pré-visualizar sugestões",
  "automation.proactive.evaluate": "Avaliar agora",
  "automation.proactive.refreshNoise": "Atualizar métricas de ruído",
  "automation.proactive.delivered": "Sugestões entregues",
  "automation.proactive.dismiss": "Dispensar {title}",
  "automation.proactive.previewHeading": "Pré-visualização fundamentada",
  "automation.proactive.previewLabel": "Pré-visualização das sugestões",
  "automation.proactive.previewEmpty":
    "Nenhum item de ação do Kage elegível, aceito e sem responsável.",
  "automation.proactive.evidence":
    "Evidência: reunião {meeting}, item {item} ({source}): “{quote}”",
  "automation.proactive.sourceTranscript": "transcrição",
  "automation.proactive.sourceSummary": "resumo",
  "automation.proactive.noiseLabel": "Métricas de ruído das sugestões",
  "automation.proactive.noiseDelivered": "Entregues",
  "automation.proactive.noiseDismissed": "Dispensadas",
  "automation.proactive.noiseSuppressed": "Suprimidas",
  "automation.proactive.noiseRate": "Taxa de dispensa",
  "automation.proactive.saved": "Preferências de sugestões salvas.",
  "automation.proactive.previewCount":
    "{count, plural, one {# sugestão fundamentada na pré-visualização.} other {# sugestões fundamentadas na pré-visualização.}}",
  "automation.proactive.evaluated": "{delivered} entregues; {suppressed} suprimidas.",
  "automation.proactive.dismissed": "Sugestão dispensada.",

  // ---- capability registry (RegistrySettings.tsx) ----
  "automation.registry.title": "Registro de capacidades",
  "automation.registry.intro":
    "Navegue pelos metadados de um índice assinado, configurado localmente e confiável para o host. O Phoenix Core verifica a assinatura do índice antes de retornar as entradas. Navegar não instala nem executa código de terceiros.",
  "automation.registry.noInstall":
    "Instalação indisponível: não há um sandbox de SO auditado. Capacidades de terceiros não podem ser instaladas aqui.",
  "automation.registry.unavailable": "Registro indisponível",
  "automation.registry.loadFailed": "Não foi possível carregar o registro: {error}",
  "automation.registry.loading": "Carregando registro…",
  "automation.registry.notConfigured":
    "Nenhum registro local está configurado. Peça ao administrador do host que configure uma chave confiável e um índice assinado para navegar pelas capacidades.",
  "automation.registry.indexSignature":
    "Assinatura do índice: verificada com o signatário Ed25519 {signer}, confiável para o host.",
  "automation.registry.signature": "Assinatura: {signature}",
  "automation.registry.indexHash": "SHA-256 do índice assinado: {hash}",
  "automation.registry.empty": "O registro assinado não contém capacidades.",
  "automation.registry.preview": "Pré-visualizar {name} {version}",
  "automation.registry.previewFailed": "Pré-visualização indisponível: {error}",
  "automation.registry.previewLoading": "Carregando pré-visualização verificada…",
  "automation.registry.permissions": "Permissões",
  "automation.registry.noDescription": "Nenhuma descrição fornecida",
  "automation.registry.noneDeclared": "Nenhuma declarada.",
  "automation.registry.dataCategories": "Categorias de dados",
  "automation.registry.licence": "Licença",
  "automation.registry.licenceLine": "{licence}. {policy}",
  "automation.registry.security": "Segurança",
  "automation.registry.securityContact": "Contato de segurança",
  "automation.registry.advisories": "Avisos de segurança",
  "automation.registry.provenance": "Procedência assinada",
  "automation.registry.artifact":
    "SHA-256 do artefato declarado pelo índice assinado: {hash} ({bytes, plural, one {# byte} other {# bytes}}). Verificação do artefato: não verificado; os bytes do artefato não foram buscados nem conferidos. Navegar não executa o artefato.",
  "automation.registry.sandbox":
    "Sandbox: indisponível. A instalação está desativada; nenhuma solicitação de instalação será enviada.",

  "automation.registry.skinPack": "pacote de aparência somente de dados",
  "automation.registry.skinDataOnly":
    "Pacote de roupa Phoenix somente de dados. Ele não pode executar código nem solicitar permissões.",
  "automation.registry.installSkin": "Instalar aparência {name} {version}",
  "automation.registry.installPending":
    "Aguardando a confirmação do Core antes de instalar esta aparência assinada.",
  "automation.registry.installSucceeded": "Aparência assinada instalada no guarda-roupa.",
  "automation.registry.installFailed": "Falha ao instalar a aparência: {error}",
  // ---- encrypted sync (SyncSettings.tsx) ----
  "automation.sync.title": "Sincronização criptografada",
  "automation.sync.intro":
    "Opcional e desativada por padrão. A sincronização exige um relay HTTPS próprio, disponível, e autenticação no relay; o Phoenix não oferece um relay hospedado. Configurar é uma adesão explícita: nada é enviado durante a configuração, mas os registros em fila são sincronizados automaticamente quando houver conexão. Sincronizar agora inicia uma tentativa imediata. O adaptador prepara apenas as duas configurações sem conteúdo selecionadas explicitamente; alterações locais posteriores exigem Publicar atual. Texto de reuniões, pessoas e memória nunca é incluído por este adaptador.",
  "automation.sync.unavailable":
    "As configurações de sincronização estão indisponíveis no Phoenix Core. Esta consulta de status não contatou o relay.",
  "automation.sync.relayNone": "não configurado",
  "automation.sync.relayUnknown": "relay configurado (URL indisponível)",
  "automation.sync.statusOn":
    "A sincronização está ativada. {pending} na fila; {conflicts, plural, one {# conflito} other {# conflitos}}.",
  "automation.sync.statusOff":
    "A sincronização está desativada. {pending} na fila; {conflicts, plural, one {# conflito} other {# conflitos}}.",
  "automation.sync.chooseExclusions":
    "Escolha as exclusões antes de aderir; as classes e os projetos excluídos não são enviados.",
  "automation.sync.excludeClasses": "Excluir classes de dados",
  "automation.sync.class.preference": "preferência",
  "automation.sync.class.context": "contexto",
  "automation.sync.class.project_profile": "perfil de projeto",
  "automation.sync.excludeProject": "Excluir projeto pelo nome",
  "automation.sync.excludeProjectButton": "Excluir projeto",
  "automation.sync.removeExclusion": "Remover exclusão de {name}",
  "automation.sync.exclusionsSaved": "Exclusões salvas.",
  "automation.sync.adapterLegend": "Aderir individualmente a configurações existentes",
  "automation.sync.adapterNote":
    "Somente movimento reduzido (preferência) e quantidade de resultados de busca (configuração de contexto), ambos no escopo do proprietário da conta, são elegíveis; não há fontes no escopo de projeto. Selecionar prepara o valor atual. Publique explicitamente uma alteração local posterior. Os valores recebidos permanecem preparados até você revisá-los e confirmar a aplicação local. Excluir uma classe também remove a seleção do adaptador quando permitido; registros já publicados precisam ser excluídos e sincronizados antes. Desmarcar não apaga o texto cifrado já enviado; exclua o item sincronizado separadamente, se necessário.",
  "automation.sync.adapter.reducedMotion": "Preferência de movimento reduzido",
  "automation.sync.adapter.searchCount": "Metadados da quantidade de resultados de busca",
  "automation.sync.adapterSaved":
    "Seleção do adaptador salva. As configurações atuais recém-selecionadas foram preparadas; nenhuma outra fonte é incluída.",
  "automation.sync.adapterApplied": "Configuração sincronizada selecionada aplicada localmente.",
  "automation.sync.adapterPublished":
    "Configuração local atual preparada para a sincronização criptografada.",
  "automation.sync.publish": "Publicar {key} atual",
  "automation.sync.reviewApply": "Revisar a aplicação de {key}",
  "automation.sync.applyPreview": "Pré-visualização da aplicação da configuração",
  "automation.sync.applyText":
    "Aplicar a revisão {revision} de {key} preparada e descriptografada à configuração local existente? Ela substituirá o valor atual somente após a confirmação. Os valores atual e recebido ficam ocultos; identifique as versões pela origem e pela revisão, ou cancele. Um valor local ou uma revisão preparada que mude invalida esta pré-visualização.",
  "automation.sync.confirmApply": "Confirmar aplicação da configuração",
  "automation.sync.cancelApply": "Cancelar aplicação",
  "automation.sync.relayLine":
    "Relay: {relay}. Identidade: {identity}. É necessário um relay acessível; este status não comprova que o relay esteja disponível.",
  "automation.sync.identityNone": "indisponível",
  "automation.sync.identityNote":
    "Esta identidade representa a conta da chave de recuperação compartilhada, não um dispositivo distinto. Dispositivos com a mesma chave e o mesmo token de relay não podem ser revogados individualmente, e a proteção contra repetição no relay não está estabelecida.",
  "automation.sync.syncNow": "Sincronizar agora",
  "automation.sync.turnOff": "Desativar a sincronização",
  "automation.sync.turnedOff":
    "A sincronização está desativada. Os registros em fila permanecem locais.",
  "automation.sync.offlineNote":
    "Se o relay estiver offline, uma sincronização manual relata um erro e os itens pendentes permanecem na fila para nova tentativa. Nenhuma sobrescrita silenciosa ocorre em conflitos.",
  "automation.sync.syncedPending":
    "{pending, plural, one {# item ainda na fila.} other {# itens ainda na fila.}} Revise o status e os conflitos abaixo.",
  "automation.sync.syncedDone": "Sincronização concluída. Revise os itens e os conflitos abaixo.",
  "automation.sync.items": "Itens sincronizados",
  "automation.sync.itemsNote":
    "Somente metadados; o conteúdo dos itens e os valores em conflito não são exibidos.",
  "automation.sync.noItems": "Nenhum registro de sincronização preparado.",
  "automation.sync.itemLine":
    "{id} · {dataClass} · proprietário {owner} · escopo {scope} · projeto {project} · revisão {revision} · atualizado {updated} · {state}",
  "automation.sync.projectNone": "nenhum",
  "automation.sync.updatedUnknown": "desconhecido",
  "automation.sync.state.deletionQueued": "exclusão na fila",
  "automation.sync.state.deleted": "excluído",
  "automation.sync.state.queued": "na fila",
  "automation.sync.state.synced": "sincronizado",
  "automation.sync.conflictMissing":
    "Conflito: este registro não existe no relay. Mantenha o local para restaurá-lo no relay, ou aceite a exclusão remota para excluir o registro de sincronização local preparado. Nada é sobrescrito automaticamente.",
  "automation.sync.conflictRemote":
    "Conflito: revisão remota {revision}, atualizada {updated}. Nada é sobrescrito até você escolher um lado.",
  "automation.sync.reviewKeepLocal": "Revisar manter o local de {id}",
  "automation.sync.reviewKeepRemote": "Revisar manter o remoto de {id}",
  "automation.sync.reviewAcceptDeletion": "Revisar aceitar a exclusão remota de {id}",
  "automation.sync.reviewDeletion": "Revisar a exclusão remota de {id}",
  "automation.sync.resolutionPreview": "Pré-visualização da resolução do conflito",
  "automation.sync.previewFor": "Pré-visualização de {id} ({scope}):",
  "automation.sync.previewAcceptDeletion":
    "Aceitar a exclusão remota: exclui agora o registro de sincronização local preparado; nada é enviado.",
  "automation.sync.previewRestore":
    "Restaurar o remoto ausente: coloca a versão local na fila para envio na próxima sincronização bem-sucedida.",
  "automation.sync.previewKeepRemote":
    "Manter o remoto: substitui agora o registro de sincronização local preparado pela versão remota.",
  "automation.sync.previewKeepLocal":
    "Manter o local: coloca esta versão na fila para envio na próxima sincronização bem-sucedida. Uma alteração remota mais recente ainda exigirá resolução.",
  "automation.sync.previewTail":
    "O conteúdo dos itens fica oculto aqui; se não conseguir identificar as versões pelos metadados, cancele. Isto não pode ser desfeito aqui.",
  "automation.sync.confirmAcceptDeletion": "Confirmar aceitar exclusão remota",
  "automation.sync.confirmRestore": "Confirmar restaurar remoto ausente",
  "automation.sync.confirmKeepLocal": "Confirmar manter local",
  "automation.sync.confirmKeepRemote": "Confirmar manter remoto",
  "automation.sync.cancelResolution": "Cancelar resolução",
  "automation.sync.resolvedDeletion":
    "Exclusão remota aceita. O registro de sincronização local preparado agora está excluído; nada está na fila para envio.",
  "automation.sync.resolvedChoice":
    "Escolha do conflito salva. As alterações pendentes são sincronizadas automaticamente quando houver conexão; Sincronizar agora inicia uma tentativa imediata.",
  "automation.sync.deletionConfirmation": "Confirmação da exclusão remota",
  "automation.sync.deletionText":
    "Excluir {id} ({scope}) do relay? Isto coloca um marcador de exclusão (tombstone) na fila local; a cópia remota só é removida após uma sincronização bem-sucedida. Isto não pode ser desfeito aqui.",
  "automation.sync.confirmDeletion": "Confirmar exclusão remota",
  "automation.sync.cancelDeletion": "Cancelar exclusão",
  "automation.sync.deletionQueued":
    "Exclusão na fila. A cópia remota só é excluída após uma sincronização bem-sucedida.",
  "automation.sync.relayUrl": "URL HTTPS do relay",
  "automation.sync.relayToken": "Token de autenticação do relay",
  "automation.sync.restoreKey":
    "Chave de recuperação existente (opcional, para restaurar uma identidade)",
  "automation.sync.optInNote":
    "Adesão explícita: configurar armazena as credenciais do relay localmente e ativa a sincronização automática dos registros em fila quando houver conexão. Uma nova identidade exibe uma chave de recuperação uma única vez: salve-a imediatamente; ela não poderá ser recuperada depois. Reconfigurar após desativar a sincronização reutiliza a identidade armazenada localmente, quando disponível. Nunca compartilhe sua chave com o operador do relay.",
  "automation.sync.configure": "Configurar a sincronização criptografada",
  "automation.sync.configured":
    "A sincronização está configurada. Os registros em fila são sincronizados automaticamente quando houver conexão; Sincronizar agora inicia uma tentativa imediata.",
  "automation.sync.recoveryGroup": "Chave de recuperação de uso único",
  "automation.sync.recoveryText":
    "Copie e guarde esta chave de recuperação em um local seguro agora. Ela é exibida apenas uma vez e não pode ser recuperada depois. Não a compartilhe.",
  "automation.sync.copyKey": "Copiar chave de recuperação",
  "automation.sync.savedKey": "Salvei a chave — dispensar",
  "automation.sync.refresh": "Atualizar status da sincronização",
};
