'use client'

import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { jsPDF } from 'jspdf'
import { 
  FileText, Send, Download, CheckCircle, AlertCircle, ChevronRight,
  Scale, Shield, Brain, RefreshCw, Loader2, User, Bot, AlertTriangle
} from 'lucide-react'

// ============================================================================
// CONFIGURATION
// ============================================================================

// LLM endpoint - uses Groq API backend
const LLM_API_URL = '/api/llm'

// ============================================================================
// TYPES
// ============================================================================

interface Question {
  id: string
  question: string
  type: 'text' | 'select' | 'date' | 'boolean'
  options?: string[]
  required: boolean
  legalLabel?: string // How this field should appear in legal document
}

interface ValidationRule {
  type: 'contradiction' | 'required_with' | 'format'
  fields: string[]
  condition: (answers: Record<string, unknown>) => boolean
  message: string
}

interface DocumentConfig {
  name: string
  description: string
  questions: Question[]
  validationRules: ValidationRule[]
  clauseGenerator: (field: string, value: unknown, answers: Record<string, unknown>) => string
}

interface Message {
  role: 'user' | 'assistant'
  content: string
}

// ============================================================================
// DOCUMENT CONFIGURATIONS (Modular - add new docs via config)
// ============================================================================

const DOCUMENTS: Record<string, DocumentConfig> = {
  will: {
    name: "Last Will and Testament",
    description: "Distribute your assets according to your wishes",
    questions: [
      { id: 'full_name', question: 'What is your full legal name?', type: 'text', required: true, legalLabel: 'Testator' },
      { id: 'date_of_birth', question: 'What is your date of birth? (YYYY-MM-DD)', type: 'date', required: true },
      { id: 'address', question: 'What is your residential address?', type: 'text', required: true },
      { id: 'marital_status', question: 'What is your current marital status?', type: 'select', options: ['Single', 'Married', 'Divorced', 'Widowed', 'Separated'], required: true },
      { id: 'spouse_name', question: 'What is your spouse\'s full name?', type: 'text', required: false },
      { id: 'has_children', question: 'Do you have any children?', type: 'boolean', required: true },
      { id: 'children_details', question: 'Please list your children (Name, Age on each line)', type: 'text', required: false },
      { id: 'executor_name', question: 'Who will be the executor of your will?', type: 'text', required: true },
      { id: 'executor_relationship', question: 'What is your relationship with the executor?', type: 'select', options: ['Spouse', 'Child', 'Parent', 'Sibling', 'Friend', 'Attorney', 'Other'], required: true },
      { id: 'has_alternate_executor', question: 'Do you want to name an alternate executor?', type: 'boolean', required: true },
      { id: 'alternate_executor_name', question: 'What is the alternate executor\'s name?', type: 'text', required: false },
      { id: 'has_specific_bequests', question: 'Do you have specific items to leave to specific people?', type: 'boolean', required: true },
      { id: 'bequest_details', question: 'Describe each item and recipient (Item - Recipient, one per line)', type: 'text', required: false },
      { id: 'residual_beneficiary', question: 'Who will receive the remainder of your estate?', type: 'text', required: true },
      { id: 'has_minor_children', question: 'Do you have minor children needing a guardian?', type: 'boolean', required: true },
      { id: 'guardian_name', question: 'Who will be the guardian?', type: 'text', required: false },
      { id: 'funeral_wishes', question: 'Any funeral or burial wishes?', type: 'text', required: false },
    ],
    // Validation rules for contradiction detection
    validationRules: [
      {
        type: 'contradiction',
        fields: ['marital_status', 'spouse_name'],
        condition: (answers) => {
          const status = answers['marital_status']
          const spouseName = String(answers['spouse_name'] || '').toLowerCase().trim()
          // Check for explicit "no spouse" responses when married
          const noSpousePhrases = ['no spouse', 'dont have spouse', 'don\'t have spouse', 'no husband', 'no wife', 'none', 'n/a', 'na', 'null', 'skip', 'not applicable']
          const isNoSpouseResponse = noSpousePhrases.some(phrase => spouseName.includes(phrase))
          
          if (status === 'Married') {
            // Married but no spouse name provided OR explicitly said "no spouse"
            if (!answers['spouse_name'] || isNoSpouseResponse) return true
          }
          if (status === 'Single' && answers['spouse_name'] && !isNoSpouseResponse) {
            // Single but provided a spouse name
            return true
          }
          return false
        },
        message: 'CONTRADICTION DETECTED: You indicated you are "Married" but stated you don\'t have a spouse. Please clarify: Are you currently legally married? If so, please provide your spouse\'s name. If not married, please go back and correct your marital status.'
      },
      {
        type: 'contradiction',
        fields: ['full_name', 'executor_name'],
        condition: (answers) => {
          const fullName = String(answers['full_name'] || '').toLowerCase().trim()
          const executorName = String(answers['executor_name'] || '').toLowerCase().trim()
          // Testator cannot be their own executor
          return fullName === executorName && fullName !== ''
        },
        message: 'LOGICAL ERROR: You cannot appoint yourself as executor. Please provide the name of another person to serve as executor.'
      },
      {
        type: 'required_with',
        fields: ['has_children', 'children_details'],
        condition: (answers) => {
          return answers['has_children'] === true && !answers['children_details']
        },
        message: 'You indicated you have children but did not provide their details.'
      },
      {
        type: 'required_with',
        fields: ['has_alternate_executor', 'alternate_executor_name'],
        condition: (answers) => {
          const altName = String(answers['alternate_executor_name'] || '').toLowerCase().trim()
          const skipPhrases = ['skip', 'none', 'no', 'n/a', 'na', 'not applicable', 'idk', 'dont know']
          return answers['has_alternate_executor'] === true && (!answers['alternate_executor_name'] || skipPhrases.some(p => altName === p))
        },
        message: 'You indicated an alternate executor but did not provide their name.'
      },
      {
        type: 'required_with',
        fields: ['has_specific_bequests', 'bequest_details'],
        condition: (answers) => {
          return answers['has_specific_bequests'] === true && !answers['bequest_details']
        },
        message: 'You indicated specific bequests but did not provide details.'
      },
      {
        type: 'required_with',
        fields: ['has_minor_children', 'guardian_name'],
        condition: (answers) => {
          return answers['has_minor_children'] === true && !answers['guardian_name']
        },
        message: 'You indicated minor children but did not name a guardian.'
      },
    ],
    // Clause generator - converts raw input to professional legal language
    // RULES: No placeholders, no raw input in output, proper legal language
    clauseGenerator: (field: string, value: unknown, answers: Record<string, unknown>): string => {
      if (value === null || value === undefined || value === '') return ''
      
      // Helper: Properly capitalize names
      const capitalizeName = (name: string): string => {
        return name.trim().split(/\s+/).map(word => 
          word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
        ).join(' ')
      }
      
      // Helper: Check if value is a "skip" or negative response
      const isSkipResponse = (val: unknown): boolean => {
        if (typeof val !== 'string') return false
        const skipPhrases = ['skip', 'none', 'no', 'n/a', 'na', 'not applicable', 'idk', 'dont know', 'null', 'nothing', 'nope', 'no wish', 'no wishes']
        return skipPhrases.some(p => val.toLowerCase().trim() === p)
      }
      
      // Helper: Parse bequest line - handles various formats
      const parseBequest = (line: string): { item: string; recipient: string } | null => {
        const separators = [' - ', ' to ', ' -> ', ':', ' for ']
        for (const sep of separators) {
          if (line.toLowerCase().includes(sep)) {
            const parts = line.split(new RegExp(sep, 'i'))
            if (parts.length >= 2) {
              return { item: parts[0].trim(), recipient: parts[1].trim() }
            }
          }
        }
        return null
      }
      
      switch (field) {
        case 'full_name': {
          // CRITICAL: Address must be provided - no placeholder
          const address = answers.address as string
          if (!address || address.trim() === '') return '' // Don't render if missing
          return `I, ${capitalizeName(String(value))}, residing at ${address}`
        }
        case 'marital_status': {
          if (value === 'Married') {
            const spouseName = answers.spouse_name as string
            // Only render spouse name if it exists and is valid
            if (spouseName && !isSkipResponse(String(spouseName))) {
              return `I am currently married to ${capitalizeName(String(spouseName))}.`
            }
            // Missing spouse name - don't render this clause
            return ''
          } else if (value === 'Single') {
            return `I am currently single and have never been married.`
          } else if (value === 'Divorced') {
            return `I am currently divorced.`
          } else if (value === 'Widowed') {
            return `I am currently widowed.`
          } else if (value === 'Separated') {
            return `I am currently legally separated.`
          }
          return ''
        }
        case 'has_children':
          if (value === true) {
            const details = answers.children_details as string
            if (details && !isSkipResponse(details)) {
              const children = details.split('\n').filter(l => l.trim())
              if (children.length === 0) return ''
              const formattedChildren = children.map(line => {
                const parts = line.split(',').map(p => p.trim())
                const name = capitalizeName(parts[0] || line.trim())
                const age = parts[1] ? ` (age ${parts[1].replace(/[^0-9]/g, '')})` : ''
                return name + age
              }).join(', ')
              return `I have the following child(ren): ${formattedChildren}.`
            }
            return '' // Don't render if no details provided
          }
          return '' // Don't render if no children
        case 'executor_name': {
          // Check for self-appointment
          if (answers.full_name && String(value).toLowerCase().trim() === String(answers.full_name).toLowerCase().trim()) {
            return '' // Don't render self-appointment - invalid
          }
          // EMBED relationship into the clause (not separate sentence)
          const rel = answers.executor_relationship ? String(answers.executor_relationship).toLowerCase() : ''
          if (rel && rel !== 'other') {
            return `I appoint ${capitalizeName(String(value))}, my ${rel}, as Executor of this Will.`
          }
          return `I appoint ${capitalizeName(String(value))} as Executor of this Will.`
        }
        case 'executor_relationship':
          // REMOVE - relationship is now embedded in executor_name clause
          return ''
        case 'has_alternate_executor': {
          // Only render if TRUE and a valid name is provided
          if (value !== true) return ''
          const altName = answers.alternate_executor_name as string
          if (!altName || isSkipResponse(String(altName))) return ''
          const executorName = answers.executor_name ? capitalizeName(String(answers.executor_name)) : 'the Executor'
          return `In the event ${executorName} is unable or unwilling to serve, I appoint ${capitalizeName(String(altName))} as Alternate Executor.`
        }
        case 'has_specific_bequests': {
          if (value !== true) return ''
          const details = answers.bequest_details as string
          if (!details || isSkipResponse(details)) return ''
          const bequests = String(details).split('\n').filter(l => l.trim())
          if (bequests.length === 0) return ''
          const formattedBequests = bequests.map(line => {
            const parsed = parseBequest(line)
            if (parsed) {
              const item = parsed.item.charAt(0).toLowerCase() + parsed.item.slice(1)
              return `I bequeath my ${item} to ${capitalizeName(parsed.recipient)}.`
            }
            return `I bequeath ${capitalizeName(line)}.`
          }).join(' ')
          return formattedBequests
        }
        case 'residual_beneficiary':
          return `I give, devise, and bequeath all the rest, residue, and remainder of my estate to ${capitalizeName(String(value))}.`
        case 'has_minor_children': {
          if (value !== true) return ''
          const guardian = answers.guardian_name as string
          if (!guardian || isSkipResponse(String(guardian))) return ''
          return `I appoint ${capitalizeName(String(guardian))} as guardian for any minor children.`
        }
        case 'funeral_wishes': {
          const wishes = String(value).trim()
          // Handle negative responses - use proper legal phrasing
          if (!wishes || isSkipResponse(wishes)) {
            return '' // No wishes section to render
          }
          // Handle "no" as a response - proper legal phrasing
          const noPhrases = ['no', 'none', 'no specific wishes', 'no particular wishes', 'nope']
          if (noPhrases.some(p => wishes.toLowerCase() === p)) {
            return '' // Remove entire section if no wishes
          }
          // Capitalize first letter and format properly
          const formattedWishes = wishes.charAt(0).toUpperCase() + wishes.slice(1)
          return `My funeral and burial wishes are: ${formattedWishes}.`
        }
        default:
          return String(value)
      }
    }
  },
  power_of_attorney: {
    name: "Power of Attorney",
    description: "Appoint someone to make decisions for you",
    questions: [
      { id: 'full_name', question: 'What is your full legal name (Principal)?', type: 'text', required: true },
      { id: 'date_of_birth', question: 'What is your date of birth? (YYYY-MM-DD)', type: 'date', required: true },
      { id: 'address', question: 'What is your address?', type: 'text', required: true },
      { id: 'poa_type', question: 'Type of Power of Attorney?', type: 'select', options: ['General', 'Durable', 'Medical', 'Financial'], required: true },
      { id: 'agent_name', question: 'Name of your Agent (Attorney-in-Fact)?', type: 'text', required: true },
      { id: 'agent_address', question: 'Agent\'s address?', type: 'text', required: true },
      { id: 'agent_relationship', question: 'Relationship with Agent?', type: 'select', options: ['Spouse', 'Child', 'Parent', 'Sibling', 'Friend', 'Other'], required: true },
      { id: 'has_alternate_agent', question: 'Do you want an alternate Agent?', type: 'boolean', required: true },
      { id: 'alternate_agent_name', question: 'Name of alternate Agent?', type: 'text', required: false },
      { id: 'powers', question: 'What powers to grant?', type: 'select', options: ['All legal powers', 'Financial matters only', 'Healthcare decisions only', 'Real estate transactions only'], required: true },
      { id: 'effective_date', question: 'When does this become effective?', type: 'select', options: ['Immediately upon signing', 'Upon my incapacity (as certified by a physician)'], required: true },
      { id: 'special_instructions', question: 'Any special instructions for your Agent?', type: 'text', required: false },
    ],
    validationRules: [
      {
        type: 'contradiction',
        fields: ['full_name', 'agent_name'],
        condition: (answers) => {
          const fullName = String(answers['full_name'] || '').toLowerCase().trim()
          const agentName = String(answers['agent_name'] || '').toLowerCase().trim()
          // Principal cannot be their own agent
          return fullName === agentName && fullName !== ''
        },
        message: 'LOGICAL ERROR: You cannot appoint yourself as your own Agent. Please provide the name of another person.'
      },
      {
        type: 'required_with',
        fields: ['has_alternate_agent', 'alternate_agent_name'],
        condition: (answers) => {
          const altName = String(answers['alternate_agent_name'] || '').toLowerCase().trim()
          const skipPhrases = ['skip', 'none', 'no', 'n/a', 'na', 'not applicable', 'idk', 'dont know']
          return answers['has_alternate_agent'] === true && (!answers['alternate_agent_name'] || skipPhrases.some(p => altName === p))
        },
        message: 'You indicated an alternate agent but did not provide their name.'
      }
    ],
    // Clause generator - converts raw input to professional legal language
    // RULES: No placeholders, no raw input in output, proper legal language
    clauseGenerator: (field: string, value: unknown, answers: Record<string, unknown>): string => {
      if (value === null || value === undefined || value === '') return ''
      
      // Helper: Properly capitalize names
      const capitalizeName = (name: string): string => {
        return name.trim().split(/\s+/).map(word => 
          word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
        ).join(' ')
      }
      
      // Helper: Check if value is a "skip" or negative response
      const isSkipResponse = (val: unknown): boolean => {
        if (typeof val !== 'string') return false
        const skipPhrases = ['skip', 'none', 'no', 'n/a', 'na', 'not applicable', 'idk', 'dont know', 'null', 'nothing', 'nope', 'no wish', 'no wishes']
        return skipPhrases.some(p => val.toLowerCase().trim() === p)
      }
      
      switch (field) {
        case 'full_name': {
          // CRITICAL: Address must be provided - no placeholder
          const address = answers.address as string
          if (!address || address.trim() === '') return ''
          return `I, ${capitalizeName(String(value))}, residing at ${address} (hereinafter "Principal")`
        }
        case 'agent_name': {
          // Check for self-appointment
          if (answers.full_name && String(value).toLowerCase().trim() === String(answers.full_name).toLowerCase().trim()) {
            return '' // Don't render self-appointment - invalid
          }
          const agentAddress = answers.agent_address as string
          if (!agentAddress || agentAddress.trim() === '') return ''
          // EMBED relationship into the clause (not separate sentence)
          const rel = answers.agent_relationship ? String(answers.agent_relationship).toLowerCase() : ''
          if (rel && rel !== 'other') {
            return `I hereby appoint ${capitalizeName(String(value))}, my ${rel}, residing at ${agentAddress}, as my Attorney-in-Fact (Agent).`
          }
          return `I hereby appoint ${capitalizeName(String(value))}, residing at ${agentAddress}, as my Attorney-in-Fact (Agent).`
        }
        case 'agent_relationship':
          // REMOVE - relationship is now embedded in agent_name clause
          return ''
        case 'has_alternate_agent': {
          if (value !== true) return ''
          const altName = answers.alternate_agent_name as string
          if (!altName || isSkipResponse(String(altName))) return ''
          const agentName = answers.agent_name ? capitalizeName(String(answers.agent_name)) : 'the Agent'
          return `If ${agentName} is unable or unwilling to serve, I appoint ${capitalizeName(String(altName))} as Alternate Agent.`
        }
        case 'powers':
          return `I grant my Agent the following powers: ${value}.`
        case 'effective_date':
          return `This Power of Attorney shall become effective ${String(value).toLowerCase()}.`
        case 'special_instructions': {
          const instructions = String(value).trim()
          if (!instructions || isSkipResponse(instructions)) return ''
          const formatted = instructions.charAt(0).toUpperCase() + instructions.slice(1)
          return `Special instructions: ${formatted}.`
        }
        default:
          return String(value)
      }
    }
  }
}

// ============================================================================
// CONSISTENCY ENGINE - Pre-drafting validation for logical coherence
// ============================================================================

interface ConsistencyCheck {
  valid: boolean
  errors: string[]
  warnings: string[]
  distributionModel: 'sole_beneficiary' | 'children' | 'specific_bequests' | 'residuary' | 'mixed'
}

function checkConsistency(answers: Record<string, unknown>): ConsistencyCheck {
  const errors: string[] = []
  const warnings: string[] = []
  
  // Helper to check if value is a skip response
  const isSkipResponse = (val: unknown): boolean => {
    if (typeof val !== 'string') return false
    const skipPhrases = ['skip', 'none', 'no', 'n/a', 'na', 'not applicable', 'idk', 'dont know', 'null', 'nothing', 'nope', 'no wish', 'no wishes']
    return skipPhrases.some(p => val.toLowerCase().trim() === p)
  }
  
  // 1. Check minor children logic
  const hasMinorChildren = answers['has_minor_children'] === true
  const hasChildren = answers['has_children'] === true
  const guardianName = answers['guardian_name'] as string
  
  if (hasMinorChildren && (!guardianName || isSkipResponse(String(guardianName)))) {
    errors.push('You indicated you have minor children but did not name a guardian. Please provide a guardian name.')
  }
  
  if (!hasMinorChildren && guardianName && !isSkipResponse(String(guardianName))) {
    warnings.push('A guardian was named but you indicated no minor children. The guardian clause will not be rendered.')
  }
  
  // 2. Determine distribution model and check for conflicts
  const hasSpecificBequests = answers['has_specific_bequests'] === true && 
    answers['bequest_details'] && 
    !isSkipResponse(String(answers['bequest_details']))
  
  const residualBeneficiary = answers['residual_beneficiary'] as string
  const hasResidualBeneficiary = residualBeneficiary && !isSkipResponse(String(residualBeneficiary))
  
  const spouseName = answers['spouse_name'] as string
  const maritalStatus = answers['marital_status']
  const hasSpouse = maritalStatus === 'Married' && spouseName && !isSkipResponse(String(spouseName))
  
  const childrenDetails = answers['children_details'] as string
  const hasChildrenBeneficiaries = hasChildren && childrenDetails && !isSkipResponse(childrenDetails)
  
  // Check if spouse is named as residual beneficiary (sole beneficiary scenario)
  const spouseIsSoleBeneficiary = hasSpouse && hasResidualBeneficiary && 
    String(residualBeneficiary).toLowerCase().includes(String(spouseName).toLowerCase().split(' ')[0] || '')
  
  // 3. Distribution model conflicts
  if (hasSpecificBequests && hasChildrenBeneficiaries && spouseIsSoleBeneficiary) {
    errors.push('CONFLICT: You have multiple conflicting distribution models: spouse as sole beneficiary, children as beneficiaries, AND specific bequests. Please choose only ONE distribution approach.')
  } else if (spouseIsSoleBeneficiary && hasChildrenBeneficiaries) {
    errors.push('CONFLICT: You named your spouse as sole beneficiary but also listed children as beneficiaries. Please choose ONE primary distribution model.')
  }
  
  // Determine primary distribution model
  let distributionModel: ConsistencyCheck['distributionModel'] = 'residuary'
  if (spouseIsSoleBeneficiary) {
    distributionModel = 'sole_beneficiary'
  } else if (hasChildrenBeneficiaries && hasResidualBeneficiary) {
    distributionModel = 'mixed'
  } else if (hasSpecificBequests) {
    distributionModel = 'specific_bequests'
  } else if (hasChildrenBeneficiaries) {
    distributionModel = 'children'
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    distributionModel
  }
}

// ============================================================================
// VALIDATION ENGINE
// ============================================================================

function validateAnswers(
  config: DocumentConfig, 
  answers: Record<string, unknown>
): { valid: boolean; errors: string[]; contradictions: string[] } {
  const errors: string[] = []
  const contradictions: string[] = []
  
  // Check required fields
  for (const q of config.questions) {
    if (q.required) {
      const value = answers[q.id]
      if (value === null || value === undefined || value === '') {
        // Check if this field is conditional
        const isConditional = config.validationRules.some(
          r => r.type === 'required_with' && r.fields.includes(q.id) && !r.condition(answers)
        )
        if (!isConditional) {
          errors.push(`Missing required field: ${q.question}`)
        }
      }
    }
  }
  
  // Check validation rules
  for (const rule of config.validationRules) {
    if (rule.condition(answers)) {
      if (rule.type === 'contradiction') {
        contradictions.push(rule.message)
      } else {
        errors.push(rule.message)
      }
    }
  }
  
  // Run consistency checks
  const consistency = checkConsistency(answers)
  errors.push(...consistency.errors)
  
  return {
    valid: errors.length === 0 && contradictions.length === 0,
    errors,
    contradictions
  }
}

// ============================================================================
// DRAFTING ENGINE (LLM with strict constraints)
// ============================================================================

class DraftingEngine {
  private history: Map<string, Array<{role: string, content: string}>> = new Map()

  // Guardrails: Check for prompt injection attempts
  private detectPromptInjection(input: string): boolean {
    const injectionPatterns = [
      'ignore previous', 'ignore instructions', 'disregard', 'system prompt',
      'you are now', 'act as', 'pretend', 'jailbreak', 'override',
      'forget everything', 'new instructions', 'your new role'
    ]
    const lowerInput = input.toLowerCase()
    return injectionPatterns.some(p => lowerInput.includes(p))
  }

  // Guardrails: Check for legal advice requests
  private detectLegalAdviceRequest(input: string): boolean {
    const advicePatterns = [
      'should i', 'what should', 'do you recommend', 'is it legal',
      'can i legally', 'what is the law', 'legal requirement',
      'advise me', 'give me advice', 'best option'
    ]
    const lowerInput = input.toLowerCase()
    return advicePatterns.some(p => lowerInput.includes(p))
  }

  // Guardrails: Check for vague inputs
  private detectVagueInput(input: string, questionType: string): { isVague: boolean; clarification?: string } {
    const lowerInput = input.toLowerCase().trim()
    
    // Allow common skip/negative responses - these are valid, not vague
    const validShortResponses = ['no', 'yes', 'none', 'n/a', 'na', 'skip', 'nope', 'ok', 'okay']
    if (validShortResponses.includes(lowerInput)) {
      return { isVague: false }
    }
    
    // Check for single-word or very short responses (only for text questions that need details)
    if (questionType === 'text' && lowerInput.length < 3) {
      return { isVague: true, clarification: 'Your response seems too brief. Could you please provide more details?' }
    }
    
    // Check for "I don't know" or uncertain responses
    const uncertaintyPhrases = ['i dont know', 'i don\'t know', 'not sure', 'maybe', 'i guess', 'idk', 'unclear']
    if (uncertaintyPhrases.some(p => lowerInput.includes(p))) {
      return { isVague: true, clarification: 'I understand you\'re uncertain. Could you provide your best answer, or would you like me to explain what this information is used for?' }
    }
    
    return { isVague: false }
  }

  // Helper: Capitalize names properly
  private capitalizeName(name: string): string {
    return name.trim().split(/\s+/).map(word => 
      word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    ).join(' ')
  }

  // Extract structured data from user input
  async extractValue(
    sessionId: string,
    userMessage: string,
    question: Question,
    previousAnswers?: Record<string, unknown>
  ): Promise<{ value: unknown; needsClarification: boolean; clarification?: string; guardrailTriggered?: string }> {
    
    // GUARDRAIL 1: Check for prompt injection
    if (this.detectPromptInjection(userMessage)) {
      return { 
        value: null, 
        needsClarification: true, 
        clarification: 'I cannot process that request. Please provide a direct answer to the question.',
        guardrailTriggered: 'prompt_injection'
      }
    }

    // GUARDRAIL 2: Check for legal advice requests
    if (this.detectLegalAdviceRequest(userMessage)) {
      return { 
        value: null, 
        needsClarification: true, 
        clarification: 'I cannot provide legal advice. I can only help you create documents based on your decisions. Please consult a qualified attorney for legal guidance.',
        guardrailTriggered: 'legal_advice'
      }
    }

    // GUARDRAIL 3: Check for vague inputs
    const vaguenessCheck = this.detectVagueInput(userMessage, question.type)
    if (vaguenessCheck.isVague) {
      return { 
        value: null, 
        needsClarification: true, 
        clarification: vaguenessCheck.clarification!
      }
    }

    // GUARDRAIL 4: Check for contradictions with previous answers
    if (previousAnswers && question.id === 'spouse_name') {
      const maritalStatus = previousAnswers['marital_status']
      const lowerInput = userMessage.toLowerCase()
      const noSpousePhrases = ['no spouse', 'dont have spouse', 'don\'t have spouse', 'no husband', 'no wife', 'none', 'n/a', 'na']
      
      if (maritalStatus === 'Married' && noSpousePhrases.some(p => lowerInput.includes(p))) {
        return {
          value: null,
          needsClarification: true,
          clarification: 'CONTRADICTION DETECTED: You indicated you are "Married" but now say you don\'t have a spouse. Please clarify: Are you currently legally married? If yes, please provide your spouse\'s name. If no, please tell me and I\'ll update your marital status.',
          guardrailTriggered: 'contradiction'
        }
      }
    }

    // For text fields that are names, auto-capitalize
    if (question.type === 'text' && (question.id.includes('name') || question.id === 'full_name')) {
      return { value: this.capitalizeName(userMessage), needsClarification: false }
    }
    
    // For boolean, convert common responses
    if (question.type === 'boolean') {
      const lowerInput = userMessage.toLowerCase()
      if (['yes', 'y', 'yeah', 'yep', 'true', 'correct', 'affirmative'].includes(lowerInput)) {
        return { value: true, needsClarification: false }
      }
      if (['no', 'n', 'nope', 'false', 'incorrect', 'negative', 'skip'].includes(lowerInput)) {
        return { value: false, needsClarification: false }
      }
    }
    
    // For select, match against options
    if (question.type === 'select' && question.options) {
      const match = question.options.find(o => 
        o.toLowerCase() === userMessage.toLowerCase() ||
        o.toLowerCase().includes(userMessage.toLowerCase())
      )
      if (match) return { value: match, needsClarification: false }
    }
    
    // For date fields, validate format
    if (question.type === 'date') {
      const dateMatch = userMessage.match(/\d{4}-\d{2}-\d{2}/)
      if (dateMatch) {
        return { value: dateMatch[0], needsClarification: false }
      }
      // Try to extract date from text
      return { value: userMessage, needsClarification: false }
    }
    
    // For complex text fields, use LLM for extraction
    const prompt = `You are a data extraction system for legal documents. Extract ONLY the requested information.

Question: "${question.question}"
Type: ${question.type}
${question.options ? `Valid options: ${question.options.join(', ')}` : ''}

User's response: "${userMessage}"

RULES:
1. Extract ONLY the relevant data, no extra words
2. For names: Return properly capitalized name (e.g., "John Smith")
3. For dates: Return in YYYY-MM-DD format
4. For boolean: Return true or false only
5. For select: Return exactly one of the valid options
6. If vague/unclear, return null and provide clarification question
7. Never add information not provided by user

Return JSON: {"value": <extracted or null>, "needsClarification": <bool>, "clarification": "<question if needed>"}`

    try {
      const res = await this.callLLM(sessionId, prompt)
      const match = res.match(/\{[\s\S]*\}/)
      if (match) {
        const parsed = JSON.parse(match[0])
        return parsed
      }
    } catch (e) {
      console.error('LLM extraction error:', e)
    }
    
    // Fallback - return the value directly
    return { value: userMessage, needsClarification: false }
  }

  // Generate professional legal clause using LLM
  async draftClause(
    sessionId: string,
    field: string,
    rawValue: unknown,
    allAnswers: Record<string, unknown>,
    config: DocumentConfig
  ): Promise<string> {
    // First, use the built-in clause generator
    const baseClause = config.clauseGenerator(field, rawValue, allAnswers)
    
    // If we have a good clause from generator, use it
    if (baseClause && baseClause.length > 20) {
      return baseClause
    }
    
    // Otherwise, ask LLM to draft (with strict constraints)
    const prompt = `Draft a professional legal clause for a ${config.name}.

Field: ${field}
Raw value: ${rawValue}
Context: ${JSON.stringify(allAnswers)}

RULES:
1. Use formal legal language
2. Be concise (1-2 sentences max)
3. Do NOT add any information not provided
4. Do NOT give legal advice
5. Return ONLY the clause text, nothing else
6. Do not use placeholders like [Address] or [Name]`

    try {
      const res = await this.callLLM(sessionId, prompt)
      return res.replace(/^["']|["']$/g, '').trim()
    } catch {
      return baseClause || ''
    }
  }

  // Call LLM API (Groq backend)
  private async callLLM(sessionId: string, prompt: string): Promise<string> {
    if (!this.history.has(sessionId)) {
      this.history.set(sessionId, [])
    }
    const h = this.history.get(sessionId)!
    
    // Build messages array with system prompt and history
    const messages = [
      { role: 'system', content: 'You are a legal document drafting assistant for creating wills and power of attorney documents. Follow instructions exactly. Return only valid JSON when requested. Never add information not provided by the user. Never use placeholders like [Address] or [Name]. Be concise and professional.' },
      ...h.slice(-6), // Keep last 6 messages for context
      { role: 'user', content: prompt }
    ]
    
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(LLM_API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages })
        })
        
        const data = await res.json()
        
        if (data.success && data.response) {
          const response = data.response.trim()
          h.push({ role: 'user', content: prompt })
          h.push({ role: 'assistant', content: response })
          return response
        }
        
        // If error, wait and retry
        if (!data.success && attempt < 2) {
          await new Promise(r => setTimeout(r, 2000))
          continue
        }
        
        throw new Error(data.error || 'LLM API error')
      } catch (e) {
        console.error('LLM call error:', e)
        if (attempt === 2) throw e
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
      }
    }
    return ''
  }

  clear(sessionId: string) {
    this.history.delete(sessionId)
  }
}

const draftingEngine = new DraftingEngine()

// ============================================================================
// PDF GENERATOR (Deterministic, Reproducible, No Placeholders)
// ============================================================================

function generatePDF(
  docType: string,
  answers: Record<string, unknown>,
  clauses: Record<string, string>
): void {
  const config = DOCUMENTS[docType]
  if (!config) return

  const pdf = new jsPDF()
  const pageWidth = pdf.internal.pageSize.getWidth()
  const margin = 20
  const maxWidth = pageWidth - margin * 2
  let y = 25

  // Helper: Check if value is a skip response
  const isSkipResponse = (val: unknown): boolean => {
    if (typeof val !== 'string') return false
    const skipPhrases = ['skip', 'none', 'no', 'n/a', 'na', 'not applicable', 'idk', 'dont know', 'null', 'nothing', 'nope', 'no wish', 'no wishes']
    return skipPhrases.some(p => val.toLowerCase().trim() === p)
  }

  // Header
  pdf.setFontSize(18)
  pdf.setFont('helvetica', 'bold')
  pdf.text(config.name.toUpperCase(), pageWidth / 2, y, { align: 'center' })
  y += 10
  
  // Divider line
  pdf.setDrawColor(200)
  pdf.line(margin, y, pageWidth - margin, y)
  y += 10

  // Preamble - ONLY if address exists (no placeholder)
  pdf.setFontSize(11)
  pdf.setFont('helvetica', 'normal')
  
  const address = answers.address as string
  const fullName = answers.full_name as string
  
  if (fullName && address && !isSkipResponse(address)) {
    const capitalizeName = (name: string): string => 
      name.trim().split(/\s+/).map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ')
    const preamble = `I, ${capitalizeName(String(fullName))}, residing at ${address}`
    const lines = pdf.splitTextToSize(preamble, maxWidth)
    for (const line of lines) {
      pdf.text(line, margin, y)
      y += 6
    }
    y += 5
  }

  // Date of Birth - ONLY if provided
  if (answers.date_of_birth) {
    pdf.setFontSize(10)
    pdf.text(`Date of Birth: ${answers.date_of_birth}`, margin, y)
    y += 10
  }

  // Sections - ONLY render if clause has actual content
  // NO ARTICLE REFERENCES - plain section headers
  const sections: Record<string, string[]> = {
    'Family Information': ['marital_status', 'has_children'],
    'Executor': ['executor_name', 'has_alternate_executor'],
    'Bequests': ['has_specific_bequests', 'residual_beneficiary'],
    'Guardian': ['has_minor_children'],
    'Additional Wishes': ['funeral_wishes']
  }

  for (const [sectionTitle, fields] of Object.entries(sections)) {
    // Get only clauses that have actual content (not empty string)
    const validClauses = fields
      .map(f => clauses[f])
      .filter(c => c && c.trim().length > 0)
    
    // Skip entire section if no valid content
    if (validClauses.length === 0) continue

    // Section header
    if (y > 250) {
      pdf.addPage()
      y = 25
    }
    
    pdf.setFontSize(12)
    pdf.setFont('helvetica', 'bold')
    pdf.text(sectionTitle, margin, y)
    y += 7
    
    pdf.setFontSize(10)
    pdf.setFont('helvetica', 'normal')
    
    for (const clause of validClauses) {
      if (y > 270) {
        pdf.addPage()
        y = 25
      }
      
      const clauseLines = pdf.splitTextToSize(clause, maxWidth)
      for (const line of clauseLines) {
        pdf.text(line, margin, y)
        y += 5
      }
      y += 3
    }
    y += 5
  }

  // Signature block
  if (y > 230) {
    pdf.addPage()
    y = 25
  }
  
  y += 10
  pdf.line(margin, y, pageWidth - margin, y)
  y += 10
  
  pdf.setFontSize(11)
  pdf.setFont('helvetica', 'bold')
  pdf.text('IN WITNESS WHEREOF', margin, y)
  y += 7
  
  pdf.setFont('helvetica', 'normal')
  pdf.text('I have executed this document on _________________, 20___.', margin, y)
  y += 15
  
  pdf.line(margin, y, margin + 80, y)
  y += 5
  const capitalizeName = (name: string): string => 
    name.trim().split(/\s+/).map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ')
  pdf.text(`${fullName ? capitalizeName(String(fullName)) : 'Testator'}`, margin, y)
  y += 15

  // Witnesses
  pdf.setFont('helvetica', 'bold')
  pdf.text('WITNESSES:', margin, y)
  y += 10
  
  pdf.setFont('helvetica', 'normal')
  for (let i = 0; i < 2; i++) {
    pdf.text('Signature: _________________________________', margin, y)
    y += 5
    pdf.text('Print Name: ________________________________', margin, y)
    y += 5
    pdf.text('Address: __________________________________', margin, y)
    y += 10
  }

  // Footer disclaimer
  const pageCount = pdf.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    pdf.setPage(i)
    pdf.setFontSize(8)
    pdf.setFont('helvetica', 'italic')
    pdf.setTextColor(128)
    pdf.text(
      'This document was generated by an automated system. It does not constitute legal advice. ' +
      'Please consult a qualified attorney to ensure this document meets your needs.',
      pageWidth / 2, 287, { align: 'center', maxWidth: pageWidth - 40 }
    )
    pdf.setTextColor(0)
  }

  pdf.save(`${docType}_${new Date().toISOString().split('T')[0]}.pdf`)
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function LegalDocGenerator() {
  const [docType, setDocType] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [rawAnswers, setRawAnswers] = useState<Record<string, unknown>>({})
  const [clauses, setClauses] = useState<Record<string, string>>({})
  const [qIndex, setQIndex] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [validationResult, setValidationResult] = useState<{ valid: boolean; errors: string[]; contradictions: string[] } | null>(null)
  const [done, setDone] = useState(false)
  const [resolvingValidation, setResolvingValidation] = useState(false)
  const [currentValidationIndex, setCurrentValidationIndex] = useState(0)
  const [guardrailActive, setGuardrailActive] = useState<string | null>(null)
  const [showStructuredData, setShowStructuredData] = useState(false)
  const [pdfValidationError, setPdfValidationError] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [sessionId] = useState(() => `s${Date.now()}`)
  const scrollRef = useRef<HTMLDivElement>(null)

  const config = docType ? DOCUMENTS[docType] : null
  
  // Get current question based on conditional logic
  const getCurrentQuestion = (): Question | null => {
    if (!config) return null
    for (let i = qIndex; i < config.questions.length; i++) {
      const q = config.questions[i]
      // Check conditional requirements
      if (q.id === 'spouse_name' && rawAnswers['marital_status'] !== 'Married') continue
      if (q.id === 'children_details' && rawAnswers['has_children'] !== true) continue
      if (q.id === 'alternate_executor_name' && rawAnswers['has_alternate_executor'] !== true) continue
      if (q.id === 'bequest_details' && rawAnswers['has_specific_bequests'] !== true) continue
      if (q.id === 'guardian_name' && rawAnswers['has_minor_children'] !== true) continue
      if (q.id === 'alternate_agent_name' && rawAnswers['has_alternate_agent'] !== true) continue
      return q
    }
    return null
  }
  
  const question = getCurrentQuestion()
  const progress = config ? ((qIndex / config.questions.length) * 100) : 0

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight)
  }, [messages])

  const startDoc = (type: string) => {
    setDocType(type)
    setMessages([])
    setRawAnswers({})
    setClauses({})
    setQIndex(0)
    setDone(false)
    setError(null)
    setValidationResult(null)
    
    const cfg = DOCUMENTS[type]
    const firstQ = cfg.questions[0]
    setMessages([{ 
      role: 'assistant', 
      content: `Welcome! I'll help you create your ${cfg.name}. ${firstQ.question}` 
    }])
  }

  const send = async (value?: string) => {
    const msg = value || input.trim()
    if (!msg || !question || loading) return
    
    setLoading(true)
    setError(null)
    setInput('')
    setMessages(m => [...m, { role: 'user', content: msg }])

    try {
      // Step 1: Extract structured value (with guardrails)
      const result = await draftingEngine.extractValue(sessionId, msg, question, rawAnswers)
      
      // If guardrail triggered, show warning icon
      if (result.guardrailTriggered) {
        // Log guardrail for visibility
        console.log(`Guardrail triggered: ${result.guardrailTriggered}`)
        setGuardrailActive(result.guardrailTriggered)
        setTimeout(() => setGuardrailActive(null), 3000)
      }
      
      if (result.needsClarification && result.clarification) {
        setMessages(m => [...m, { role: 'assistant', content: result.clarification! }])
        setLoading(false)
        return
      }

      // Step 2: Store raw answer
      const newRawAnswers = { ...rawAnswers, [question.id]: result.value }
      setRawAnswers(newRawAnswers)

      // Step 3: Generate legal clause
      const clause = await draftingEngine.draftClause(
        sessionId, 
        question.id, 
        result.value, 
        newRawAnswers, 
        config!
      )
      setClauses(c => ({ ...c, [question.id]: clause }))

      // Step 4: Find next question
      let nextIdx = qIndex + 1
      let nextQ: Question | null = null
      for (let i = nextIdx; i < config!.questions.length; i++) {
        const q = config!.questions[i]
        // Skip conditional questions
        if (q.id === 'spouse_name' && newRawAnswers['marital_status'] !== 'Married') continue
        if (q.id === 'children_details' && newRawAnswers['has_children'] !== true) continue
        if (q.id === 'alternate_executor_name' && newRawAnswers['has_alternate_executor'] !== true) continue
        if (q.id === 'bequest_details' && newRawAnswers['has_specific_bequests'] !== true) continue
        if (q.id === 'guardian_name' && newRawAnswers['has_minor_children'] !== true) continue
        if (q.id === 'alternate_agent_name' && newRawAnswers['has_alternate_agent'] !== true) continue
        nextQ = q
        nextIdx = i
        break
      }

      setQIndex(nextIdx)

      if (nextQ) {
        setMessages(m => [...m, { 
          role: 'assistant', 
          content: `Thank you. ${nextQ.question}` 
        }])
      } else {
        // Validate before completing
        const validation = validateAnswers(config!, newRawAnswers)
        setValidationResult(validation)
        
        if (!validation.valid) {
          setResolvingValidation(true)
          setCurrentValidationIndex(0)
          const allIssues = [...validation.errors, ...validation.contradictions]
          setMessages(m => [...m, { 
            role: 'assistant', 
            content: `I found ${allIssues.length} issue(s) that need attention:

${allIssues[0]}

Please provide the missing information, or type "skip" to proceed without it.` 
          }])
        } else {
          setDone(true)
          setMessages(m => [...m, { 
            role: 'assistant', 
            content: 'Perfect! All information collected. Click "Generate PDF Document" to create your legal document.' 
          }])
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error occurred')
      setMessages(m => [...m, { role: 'assistant', content: 'Sorry, an error occurred. Please try again.' }])
    }
    setLoading(false)
  }

  // Pre-PDF validation: Ensure all required fields are complete
  const validateBeforePDF = (): { valid: boolean; missingFields: string[] } => {
    const missingFields: string[] = []
    
    if (!config) return { valid: false, missingFields: ['Configuration not loaded'] }
    
    // Check required fields
    for (const q of config.questions) {
      if (q.required) {
        const value = rawAnswers[q.id]
        // Check if value is missing or empty
        if (value === null || value === undefined || value === '') {
          // Check if this field is conditional (should be skipped based on other answers)
          const isConditional = (
            (q.id === 'spouse_name' && rawAnswers['marital_status'] !== 'Married') ||
            (q.id === 'children_details' && rawAnswers['has_children'] !== true) ||
            (q.id === 'alternate_executor_name' && rawAnswers['has_alternate_executor'] !== true) ||
            (q.id === 'bequest_details' && rawAnswers['has_specific_bequests'] !== true) ||
            (q.id === 'guardian_name' && rawAnswers['has_minor_children'] !== true) ||
            (q.id === 'alternate_agent_name' && rawAnswers['has_alternate_agent'] !== true)
          )
          if (!isConditional) {
            missingFields.push(q.question.replace('?', ''))
          }
        }
      }
    }
    
    // Run validation rules
    const validation = validateAnswers(config, rawAnswers)
    if (!validation.valid) {
      missingFields.push(...validation.errors, ...validation.contradictions)
    }
    
    return { valid: missingFields.length === 0, missingFields }
  }

  const handleGeneratePDF = () => {
    if (!config) return
    setPdfValidationError(null)
    
    // Run pre-PDF validation
    const preCheck = validateBeforePDF()
    if (!preCheck.valid) {
      setPdfValidationError(`Cannot generate PDF. Missing or invalid: ${preCheck.missingFields.join(', ')}`)
      return
    }
    
    generatePDF(docType!, rawAnswers, clauses)
  }

  const handleValidationResponse = async () => {
    const msg = input.trim()
    if (!msg || !validationResult || loading) return
    
    setLoading(true)
    setInput('')
    setMessages(m => [...m, { role: 'user', content: msg }])
    
    const allIssues = [...validationResult.errors, ...validationResult.contradictions]
    const currentIssue = allIssues[currentValidationIndex]
    
    // Check if user wants to skip
    if (msg.toLowerCase() === 'skip' || msg.toLowerCase() === 'no' || msg.toLowerCase() === 'skip it') {
      setMessages(m => [...m, { 
        role: 'assistant', 
        content: `Understood. I'll note that this information was not provided.`
      }])
    } else {
      // User provided the missing info - try to determine which field to update
      // Parse the current issue to find related field
      let fieldToUpdate: string | null = null
      let extractedValue = msg
      
      // Map issue messages to field IDs
      if (currentIssue.includes('alternate executor') && currentIssue.includes('name')) {
        fieldToUpdate = 'alternate_executor_name'
      } else if (currentIssue.includes('spouse')) {
        fieldToUpdate = 'spouse_name'
      } else if (currentIssue.includes('children') && currentIssue.includes('details')) {
        fieldToUpdate = 'children_details'
      } else if (currentIssue.includes('bequest') && currentIssue.includes('details')) {
        fieldToUpdate = 'bequest_details'
      } else if (currentIssue.includes('guardian')) {
        fieldToUpdate = 'guardian_name'
      } else if (currentIssue.includes('alternate agent')) {
        fieldToUpdate = 'alternate_agent_name'
      }
      
      if (fieldToUpdate) {
        // Update the answer
        const newAnswers = { ...rawAnswers, [fieldToUpdate]: extractedValue }
        setRawAnswers(newAnswers)
        
        // Generate clause for this field
        if (config) {
          const clause = await draftingEngine.draftClause(
            sessionId,
            fieldToUpdate,
            extractedValue,
            newAnswers,
            config
          )
          setClauses(c => ({ ...c, [fieldToUpdate]: clause }))
        }
        
        setMessages(m => [...m, { 
          role: 'assistant', 
          content: `Thank you. I've updated: ${fieldToUpdate.replace(/_/g, ' ')}`
        }])
      }
    }
    
    // Check if there are more issues to resolve
    const nextIndex = currentValidationIndex + 1
    if (nextIndex < allIssues.length) {
      // More issues to resolve
      setCurrentValidationIndex(nextIndex)
      setTimeout(() => {
        setMessages(m => [...m, { 
          role: 'assistant', 
          content: `Next issue:\n\n${allIssues[nextIndex]}\n\nPlease provide the missing information, or type "skip" to proceed without it.`
        }])
        setLoading(false)
      }, 500)
    } else {
      // All issues resolved (or skipped) - revalidate
      const updatedValidation = validateAnswers(config!, rawAnswers)
      setValidationResult(updatedValidation)
      setResolvingValidation(false)
      
      if (updatedValidation.valid) {
        setDone(true)
        setMessages(m => [...m, { 
          role: 'assistant', 
          content: 'All issues resolved! Click "Generate PDF Document" to create your legal document.' 
        }])
      } else {
        // Still has issues but user chose to skip - allow proceeding
        setDone(true)
        setMessages(m => [...m, { 
          role: 'assistant', 
          content: 'Proceeding with the information provided. Note: Your document may be incomplete. Click "Generate PDF Document" to continue.' 
        }])
      }
      setLoading(false)
    }
  }

  const reset = () => {
    setDocType(null)
    setMessages([])
    setRawAnswers({})
    setClauses({})
    setQIndex(0)
    setDone(false)
    setError(null)
    setValidationResult(null)
    setResolvingValidation(false)
    setCurrentValidationIndex(0)
    draftingEngine.clear(sessionId)
  }

  // Document Selection Screen
  if (!docType) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex flex-col">
        <header className="bg-white border-b shadow-sm">
          <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-600 rounded-lg">
                <Scale className="h-5 w-5 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-semibold text-slate-900">Legal Document Generator</h1>
                <p className="text-xs text-slate-500">Modular • Reproducible • Validated</p>
              </div>
            </div>
            <Badge variant="secondary" className="gap-1">
              <Brain className="h-3 w-3" />
              LLM Drafting Engine
            </Badge>
          </div>
        </header>

        <main className="flex-1 max-w-4xl mx-auto px-4 py-8 w-full">
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold text-slate-900 mb-2">Select Document Type</h2>
            <p className="text-slate-600">Configuration-driven document generation</p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {Object.entries(DOCUMENTS).map(([key, doc]) => (
              <Card 
                key={key}
                className="cursor-pointer hover:shadow-lg hover:border-blue-300 transition-all duration-200 border-2"
                onClick={() => startDoc(key)}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-blue-50 rounded-lg">
                      <FileText className="h-5 w-5 text-blue-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-base text-slate-900">{doc.name}</CardTitle>
                      <CardDescription className="text-sm mt-1">{doc.description}</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardFooter className="pt-0">
                  <Button variant="ghost" className="w-full group justify-between">
                    Start Creating <ChevronRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-4">
            {[
              { icon: Brain, title: 'Structured Data', desc: 'JSON-based pipeline' },
              { icon: AlertTriangle, title: 'Validation', desc: 'Contradiction detection' },
              { icon: FileText, title: 'Legal Drafting', desc: 'Professional clauses' },
              { icon: Shield, title: 'Guardrails', desc: 'No fact invention' }
            ].map(({ icon: Icon, title, desc }) => (
              <Card key={title} className="bg-white/50">
                <CardContent className="pt-4">
                  <Icon className="h-5 w-5 text-blue-600 mb-2" />
                  <p className="font-medium text-sm">{title}</p>
                  <p className="text-xs text-slate-500">{desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </main>

        <footer className="border-t bg-white py-4">
          <p className="text-center text-xs text-slate-500">For informational purposes only. Not legal advice.</p>
        </footer>
      </div>
    )
  }

  // Chat Screen
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex flex-col">
      <header className="bg-white border-b shadow-sm flex-shrink-0">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={reset}>← Back</Button>
            <div className="h-4 w-px bg-slate-200" />
            <span className="font-medium text-sm truncate max-w-[200px]">{config?.name}</span>
          </div>
          <div className="flex items-center gap-2">
            {guardrailActive && (
              <Badge variant="destructive" className="text-xs gap-1 animate-pulse">
                <Shield className="h-3 w-3" />
                Guardrail: {guardrailActive.replace('_', ' ')}
              </Badge>
            )}
            <Badge variant="outline" className="text-xs">
              {qIndex}/{config?.questions.length}
            </Badge>
          </div>
        </div>
        <div className="max-w-2xl mx-auto px-4 pb-3">
          <Progress value={progress} className="h-1" />
        </div>
      </header>

      {validationResult && !validationResult.valid && (
        <div className="max-w-2xl mx-auto px-4 pt-4 w-full">
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Validation Issues</AlertTitle>
            <AlertDescription>
              {validationResult.errors.map((e, i) => <div key={i}>• {e}</div>)}
              {validationResult.contradictions.map((c, i) => <div key={i} className="font-semibold">⚠ {c}</div>)}
            </AlertDescription>
          </Alert>
        </div>
      )}

      {error && (
        <div className="max-w-2xl mx-auto px-4 pt-4 w-full">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </div>
      )}

      <main className="flex-1 max-w-2xl mx-auto w-full flex flex-col min-h-0">
        <ScrollArea className="flex-1 p-4" ref={scrollRef}>
          <div className="space-y-3">
            {messages.map((m, i) => (
              <div key={i} className={`flex gap-2 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
                <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${
                  m.role === 'user' ? 'bg-blue-600' : 'bg-slate-200'
                }`}>
                  {m.role === 'user' 
                    ? <User className="h-3.5 w-3.5 text-white" />
                    : <Bot className="h-3.5 w-3.5 text-slate-600" />
                  }
                </div>
                <div className={`max-w-[80%] px-3 py-2 rounded-lg text-sm ${
                  m.role === 'user' 
                    ? 'bg-blue-600 text-white rounded-br-none' 
                    : 'bg-white border rounded-bl-none'
                }`}>
                  <p className="whitespace-pre-wrap break-words">{m.content}</p>
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex gap-2">
                <div className="w-7 h-7 rounded-full bg-slate-200 flex items-center justify-center">
                  <Bot className="h-3.5 w-3.5 text-slate-600" />
                </div>
                <div className="bg-white border px-3 py-2 rounded-lg">
                  <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        <div className="p-4 border-t bg-white flex-shrink-0">
          {done ? (
            <div className="space-y-3">
              {pdfValidationError && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="text-sm">{pdfValidationError}</AlertDescription>
                </Alert>
              )}
              <div className="flex gap-2">
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => setShowStructuredData(!showStructuredData)}
                  className="flex-1"
                >
                  {showStructuredData ? 'Hide' : 'Show'} Structured Data
                </Button>
                <Button onClick={handleGeneratePDF} className="flex-1" size="lg">
                  <FileText className="mr-2 h-4 w-4" />
                  Generate PDF
                </Button>
              </div>
              {showStructuredData && (
                <Card className="bg-slate-50">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Structured Data (JSON)</CardTitle>
                    <CardDescription className="text-xs">This is the validated data used for document generation</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <pre className="text-xs bg-slate-100 p-2 rounded overflow-auto max-h-40">
                      {JSON.stringify(rawAnswers, null, 2)}
                    </pre>
                  </CardContent>
                </Card>
              )}
              {Object.keys(clauses).length > 0 && (
                <Card className="bg-slate-50">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Generated Legal Clauses</CardTitle>
                    <CardDescription className="text-xs">Professional legal language from drafting engine</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-xs space-y-1">
                      {Object.entries(clauses).map(([field, clause]) => (
                        clause && <div key={field} className="p-2 bg-white rounded border">
                          <span className="font-medium text-slate-500">{field}:</span> {clause}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          ) : resolvingValidation ? (
            <div className="flex gap-2">
              <Input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleValidationResponse()}
                placeholder="Provide information or type 'skip'..."
                disabled={loading}
                className="flex-1"
              />
              <Button onClick={handleValidationResponse} disabled={loading || !input.trim()}>
                <Send className="h-4 w-4" />
              </Button>
            </div>
          ) : question && (
            <div className="flex gap-2">
              {question.type === 'select' && question.options ? (
                <Select 
                  onValueChange={(v) => {
                    setInput(v)
                    // Auto-submit for select
                    setTimeout(() => send(v), 50)
                  }} 
                  disabled={loading}
                  value={input}
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Select an option..." />
                  </SelectTrigger>
                  <SelectContent>
                    {question.options.map(o => (
                      <SelectItem key={o} value={o}>{o}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : question.type === 'boolean' ? (
                <div className="flex gap-2 flex-1">
                  <Button 
                    variant="outline" 
                    className="flex-1"
                    onClick={() => send('Yes')}
                    disabled={loading}
                  >
                    Yes
                  </Button>
                  <Button 
                    variant="outline" 
                    className="flex-1"
                    onClick={() => send('No')}
                    disabled={loading}
                  >
                    No
                  </Button>
                </div>
              ) : (
                <>
                  <Input
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && send()}
                    placeholder="Type your answer..."
                    disabled={loading}
                    className="flex-1"
                  />
                  <Button onClick={() => send()} disabled={loading || !input.trim()}>
                    <Send className="h-4 w-4" />
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
