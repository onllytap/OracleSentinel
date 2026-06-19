-- ============================================================================
-- ⚠️  FICHIER LEGACY — NE PAS EXÉCUTER  ⚠️
-- ============================================================================
-- Ce fichier est conservé UNIQUEMENT comme référence historique.
--
-- DANGER : il contient des `DROP TABLE ... CASCADE` (PERTE DE DONNÉES) et un
-- schéma OBSOLÈTE, SANS colonne `tenant_id` (régression multi-tenant).
--
-- La SOURCE DE VÉRITÉ du schéma est : server/src/db/ensure-db.ts
--   - idempotent (CREATE TABLE IF NOT EXISTS, ALTER ... IF NOT EXISTS)
--   - NON destructif (aucun DROP)
--   - appliqué automatiquement au démarrage du serveur
--   - ajoute et backfill `tenant_id` sur toutes les tables multi-tenant
--
-- N'exécutez JAMAIS ce fichier sur une base contenant des données.
-- Renommé depuis `schema.sql` le 2026-06-19 (durcissement Phase 1, finding F4).
-- ============================================================================

-- AI Chat Agent Database Schema
-- Run this in PostgreSQL (Neon, Supabase, or any Postgres instance)

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Drop tables if they exist to ensure clean state (WARNING: DATA LOSS)
DROP TABLE IF EXISTS leads CASCADE;
DROP TABLE IF EXISTS messages CASCADE;
DROP TABLE IF EXISTS conversations CASCADE;

-- Conversations table
CREATE TABLE conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id VARCHAR(255) NOT NULL UNIQUE,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'completed', 'abandoned')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Messages table
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Leads table (populated when user provides email)
CREATE TABLE leads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
    email VARCHAR(255),
    phone VARCHAR(50),
    tools_mentioned TEXT[], -- Array of tools they mentioned (Shopify, Airtable, etc)
    automation_needs TEXT,  -- Summary of what they want to automate
    timeline VARCHAR(100),  -- ASAP, this month, exploring, etc
    chat_summary TEXT,      -- AI-generated summary of conversation
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_conversations_session_id ON conversations(session_id);
CREATE INDEX idx_conversations_status ON conversations(status);
CREATE INDEX idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX idx_messages_created_at ON messages(created_at);
CREATE INDEX idx_leads_email ON leads(email);
CREATE INDEX idx_leads_created_at ON leads(created_at);

-- Function to auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger for conversations updated_at
DROP TRIGGER IF EXISTS update_conversations_updated_at ON conversations;
CREATE TRIGGER update_conversations_updated_at
    BEFORE UPDATE ON conversations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
