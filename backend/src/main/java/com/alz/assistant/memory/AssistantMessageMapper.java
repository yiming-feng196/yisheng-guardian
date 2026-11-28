package com.alz.assistant.memory;

import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;

@Mapper
public interface AssistantMessageMapper {

    @Insert("""
            INSERT INTO assistant_message
              (conversation_id,turn_no,role,content,title,intent,urgent,metadata_json)
            VALUES (#{conversationId},#{turnNo},#{role},#{content},#{title},#{intent},#{urgent},#{metadataJson})
            """)
    void insert(AssistantMessage message);

    @Select("""
            SELECT * FROM assistant_message WHERE conversation_id=#{conversationId}
            ORDER BY turn_no, CASE role WHEN 'USER' THEN 1 WHEN 'ASSISTANT' THEN 2 ELSE 0 END, id
            """)
    List<AssistantMessage> listAll(String conversationId);

    @Select("""
            SELECT * FROM assistant_message
            WHERE conversation_id=#{conversationId} AND turn_no > #{afterTurn}
            ORDER BY turn_no, CASE role WHEN 'USER' THEN 1 WHEN 'ASSISTANT' THEN 2 ELSE 0 END, id
            """)
    List<AssistantMessage> listAfterTurn(@Param("conversationId") String conversationId,
                                         @Param("afterTurn") int afterTurn);

    @Select("""
            SELECT * FROM assistant_message
            WHERE conversation_id=#{conversationId} AND turn_no BETWEEN #{fromTurn} AND #{toTurn}
            ORDER BY turn_no, CASE role WHEN 'USER' THEN 1 WHEN 'ASSISTANT' THEN 2 ELSE 0 END, id
            """)
    List<AssistantMessage> listRange(@Param("conversationId") String conversationId,
                                    @Param("fromTurn") int fromTurn,
                                    @Param("toTurn") int toTurn);
}
